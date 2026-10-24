package com.vault.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Java port of telegram.server.ts
 *
 * Wraps the Telegram Bot API with:
 * - Rate-limit handling (429 → retry with retry_after)
 * - Server error retries (500-504 → exponential back-off)
 * - In-memory file-path cache (45-min TTL)
 */
@Service
public class TelegramService {

    private static final Logger log = LoggerFactory.getLogger(TelegramService.class);
    private static final String TG_API = "https://api.telegram.org";
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(120);
    private static final int MAX_RETRIES = 2;
    private static final long CACHE_TTL_MS = 45L * 60 * 1000;
    private static final int MAX_CACHE_SIZE = 5000;

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    // In-memory file path cache: file_id -> {path, expiresAt}
    private final Map<String, CachedPath> filePathCache = new ConcurrentHashMap<>();

    public TelegramService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(30))
                .build();
    }

    private String token() {
        String t = System.getProperty("TELEGRAM_BOT_TOKEN");
        if (t == null || t.isBlank()) throw new IllegalStateException("TELEGRAM_BOT_TOKEN not set");
        return t;
    }

    private String chatId() {
        String c = System.getProperty("TELEGRAM_CHAT_ID");
        if (c == null || c.isBlank()) throw new IllegalStateException("TELEGRAM_CHAT_ID not set");
        return c;
    }

    // ─── File path cache ──────────────────────────────────────────────────────

    private String getCachedFilePath(String fileId) {
        CachedPath cached = filePathCache.get(fileId);
        if (cached == null) return null;
        if (System.currentTimeMillis() > cached.expiresAt) {
            filePathCache.remove(fileId);
            return null;
        }
        return cached.path;
    }

    private void setCachedFilePath(String fileId, String path) {
        if (filePathCache.size() >= MAX_CACHE_SIZE) {
            // Evict oldest entry
            filePathCache.entrySet().stream().findFirst().ifPresent(e -> filePathCache.remove(e.getKey()));
        }
        filePathCache.put(fileId, new CachedPath(path, System.currentTimeMillis() + CACHE_TTL_MS));
    }

    public void invalidateFilePathCache(String fileId) {
        filePathCache.remove(fileId);
    }

    // ─── Core API call (JSON body) ─────────────────────────────────────────────

    public JsonNode callJson(String method, Map<String, Object> body) throws IOException, InterruptedException {
        return callJson(method, body, 0);
    }

    private JsonNode callJson(String method, Map<String, Object> body, int attempt) throws IOException, InterruptedException {
        String url = TG_API + "/bot" + token() + "/" + method;
        String jsonBody = objectMapper.writeValueAsString(body);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(REQUEST_TIMEOUT)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        JsonNode json = objectMapper.readTree(response.body());

        if (!json.path("ok").asBoolean()) {
            int errorCode = json.path("error_code").asInt();
            String description = json.path("description").asText();

            if (errorCode == 429 && attempt < MAX_RETRIES) {
                long retryAfter = json.path("parameters").path("retry_after").asLong(2) * 1000
                        + (long) (Math.random() * 500);
                Thread.sleep(retryAfter);
                return callJson(method, body, attempt + 1);
            }
            if (response.statusCode() >= 500 && attempt < MAX_RETRIES) {
                long backoff = 1000L * (long) Math.pow(2, attempt) + (long) (Math.random() * 500);
                Thread.sleep(backoff);
                return callJson(method, body, attempt + 1);
            }
            throw new IOException("Telegram " + method + " failed: " + description);
        }
        return json.path("result");
    }

    // ─── Get file path ─────────────────────────────────────────────────────────

    public String getFilePath(String fileId, boolean forceFresh) throws IOException, InterruptedException {
        if (!forceFresh) {
            String cached = getCachedFilePath(fileId);
            if (cached != null) return cached;
        }
        JsonNode result = callJson("getFile", Map.of("file_id", fileId));
        String path = result.path("file_path").asText();
        setCachedFilePath(fileId, path);
        return path;
    }

    public String getFilePath(String fileId) throws IOException, InterruptedException {
        return getFilePath(fileId, false);
    }

    // ─── Fetch file as stream ──────────────────────────────────────────────────

    /**
     * Fetches a Telegram file and returns its InputStream.
     * Retries up to 3 times, re-resolving the path on 404 (expired path).
     */
    public InputStream fetchTelegramFile(String fileId, String rangeHeader) throws IOException, InterruptedException {
        IOException lastError = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                String path = getFilePath(fileId, attempt > 0);
                String url = TG_API + "/file/bot" + token() + "/" + path;

                HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                        .uri(URI.create(url))
                        .timeout(REQUEST_TIMEOUT)
                        .GET();
                if (rangeHeader != null) reqBuilder.header("Range", rangeHeader);

                HttpResponse<InputStream> response = httpClient.send(reqBuilder.build(),
                        HttpResponse.BodyHandlers.ofInputStream());

                if (response.statusCode() == 200 || response.statusCode() == 206) {
                    return response.body();
                }
                if (response.statusCode() == 404) {
                    invalidateFilePathCache(fileId);
                }
                if (response.statusCode() == 429 || response.statusCode() >= 500) {
                    long delay = (attempt + 1) * 1500L + (long) (Math.random() * 500);
                    Thread.sleep(delay);
                    continue;
                }
                throw new IOException("Failed to fetch file from Telegram: " + response.statusCode());
            } catch (IOException e) {
                lastError = e;
                if (attempt < 2) {
                    Thread.sleep((attempt + 1) * 1200L + (long) (Math.random() * 500));
                }
            }
        }
        throw lastError != null ? lastError : new IOException("Failed to fetch file " + fileId);
    }

    // ─── Get bot updates (for settings/whoami) ────────────────────────────────

    public JsonNode getUpdates() throws IOException, InterruptedException {
        return callJson("getUpdates", Map.of("limit", 20, "timeout", 0));
    }

    // ─── Delete message ────────────────────────────────────────────────────────

    public void deleteMessage(long messageId) {
        try {
            callJson("deleteMessage", Map.of("chat_id", chatId(), "message_id", messageId));
        } catch (Exception e) {
            log.warn("deleteMessage failed (ignored): {}", e.getMessage());
        }
    }

    // ─── Kind from MIME ────────────────────────────────────────────────────────

    public static String kindFromMime(String mime) {
        if (mime == null) return "other";
        if (mime.startsWith("image/")) return "image";
        if (mime.startsWith("video/")) return "video";
        if (mime.startsWith("audio/")) return "audio";
        if (mime.equals("application/pdf")) return "pdf";
        if (mime.contains("zip") || mime.contains("rar") || mime.contains("7z")
                || mime.contains("tar") || mime.contains("gzip")) return "archive";
        return "other";
    }

    public String getChatId() {
        return chatId();
    }

    // ─── Inner classes ─────────────────────────────────────────────────────────

    private record CachedPath(String path, long expiresAt) {}
}
