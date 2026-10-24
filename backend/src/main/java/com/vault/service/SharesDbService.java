package com.vault.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.vault.model.FolderShareRow;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Java port of shares-db.server.ts
 */
@Service
public class SharesDbService {

    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;
    private final SecureRandom secureRandom = new SecureRandom();

    public SharesDbService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
    }

    private String supabaseUrl() {
        String url = System.getProperty("SUPABASE_URL");
        if (url == null || url.isBlank()) throw new IllegalStateException("SUPABASE_URL not set");
        return url.replaceAll("/$", "");
    }

    private String serviceRoleKey() {
        String key = System.getProperty("SUPABASE_SERVICE_ROLE_KEY");
        if (key == null || key.isBlank()) throw new IllegalStateException("SUPABASE_SERVICE_ROLE_KEY not set");
        return key;
    }

    private HttpRequest.Builder baseRequest(String path) {
        return HttpRequest.newBuilder()
                .uri(URI.create(supabaseUrl() + "/rest/v1/" + path))
                .timeout(Duration.ofSeconds(30))
                .header("apikey", serviceRoleKey())
                .header("Authorization", "Bearer " + serviceRoleKey())
                .header("Content-Type", "application/json")
                .header("Accept", "application/json");
    }

    private List<FolderShareRow> parseShareRows(String body) throws IOException {
        JsonNode arr = objectMapper.readTree(body);
        List<FolderShareRow> rows = new ArrayList<>();
        for (JsonNode node : arr) {
            rows.add(objectMapper.treeToValue(node, FolderShareRow.class));
        }
        return rows;
    }

    private String generateToken() {
        byte[] bytes = new byte[16];
        secureRandom.nextBytes(bytes);
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    public List<FolderShareRow> listFolderShares(String folderId) throws IOException, InterruptedException {
        String query = "folder_shares?select=*&folder_id=eq."
                + URLEncoder.encode(folderId, StandardCharsets.UTF_8)
                + "&is_active=eq.true&order=created_at.desc";
        HttpRequest request = baseRequest(query).GET().build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IOException("Supabase listFolderShares error: " + response.statusCode());
        }
        List<FolderShareRow> rows = parseShareRows(response.body());
        Instant now = Instant.now();
        rows.removeIf(s -> s.getExpiresAt() != null && Instant.parse(s.getExpiresAt()).isBefore(now));
        return rows;
    }

    public FolderShareRow getActiveFolderShare(String folderId) throws IOException, InterruptedException {
        List<FolderShareRow> shares = listFolderShares(folderId);
        return shares.isEmpty() ? null : shares.get(0);
    }

    public FolderShareRow createFolderShare(String folderId, String label, boolean allowUpload,
                                             boolean allowDownload, String expiresAt)
            throws IOException, InterruptedException {

        Map<String, Object> row = new java.util.HashMap<>();
        row.put("folder_id", folderId);
        row.put("token", generateToken());
        row.put("label", label);
        row.put("allow_upload", allowUpload);
        row.put("allow_download", allowDownload);
        row.put("expires_at", expiresAt);
        row.put("is_active", true);

        HttpRequest request = baseRequest("folder_shares?select=*")
                .header("Prefer", "return=representation")
                .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(row)))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IOException("Supabase createFolderShare error: " + response.statusCode() + " " + response.body());
        }
        List<FolderShareRow> rows = parseShareRows(response.body());
        return rows.isEmpty() ? null : rows.get(0);
    }

    public FolderShareRow updateFolderShare(String shareId, Map<String, Object> opts)
            throws IOException, InterruptedException {

        Map<String, Object> patch = new java.util.HashMap<>(opts);
        patch.put("updated_at", Instant.now().toString());

        HttpRequest request = baseRequest("folder_shares?id=eq."
                + URLEncoder.encode(shareId, StandardCharsets.UTF_8) + "&select=*")
                .header("Prefer", "return=representation")
                .method("PATCH", HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(patch)))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IOException("Supabase updateFolderShare error: " + response.statusCode());
        }
        List<FolderShareRow> rows = parseShareRows(response.body());
        return rows.isEmpty() ? null : rows.get(0);
    }

    public void revokeFolderShare(String shareId) throws IOException, InterruptedException {
        Map<String, Object> patch = Map.of("is_active", false);
        HttpRequest request = baseRequest("folder_shares?id=eq."
                + URLEncoder.encode(shareId, StandardCharsets.UTF_8))
                .method("PATCH", HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(patch)))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IOException("Supabase revokeFolderShare error: " + response.statusCode());
        }
    }

    public FolderShareRow validateShareToken(String token) throws IOException, InterruptedException {
        if (token == null || token.length() < 16) return null;
        String query = "folder_shares?select=*&token=eq."
                + URLEncoder.encode(token, StandardCharsets.UTF_8)
                + "&is_active=eq.true&limit=1";
        HttpRequest request = baseRequest(query).GET().build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IOException("Supabase validateShareToken error: " + response.statusCode());
        }
        List<FolderShareRow> rows = parseShareRows(response.body());
        if (rows.isEmpty()) return null;
        FolderShareRow share = rows.get(0);
        if (share.getExpiresAt() != null && Instant.parse(share.getExpiresAt()).isBefore(Instant.now())) {
            return null;
        }
        return share;
    }

    public FolderShareRow getFolderShare(String shareId) throws IOException, InterruptedException {
        String query = "folder_shares?id=eq."
                + URLEncoder.encode(shareId, StandardCharsets.UTF_8) + "&select=*";
        HttpRequest request = baseRequest(query).GET().build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IOException("Supabase getFolderShare error: " + response.statusCode());
        }
        List<FolderShareRow> rows = parseShareRows(response.body());
        return rows.isEmpty() ? null : rows.get(0);
    }
}
