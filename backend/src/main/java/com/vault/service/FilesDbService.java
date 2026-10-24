package com.vault.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.vault.model.FileRow;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Java port of files-db.server.ts
 * Talks to Supabase REST API directly using Java HttpClient.
 */
@Service
public class FilesDbService {

    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public FilesDbService(ObjectMapper objectMapper) {
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

    private List<FileRow> parseFileRows(String body) throws IOException {
        JsonNode arr = objectMapper.readTree(body);
        List<FileRow> rows = new ArrayList<>();
        for (JsonNode node : arr) {
            rows.add(objectMapper.treeToValue(node, FileRow.class));
        }
        return rows;
    }

    // ─── List files ────────────────────────────────────────────────────────────

    public List<FileRow> listFiles(String q, String kind, String sort, String folderId, boolean folderIdIsNull)
            throws IOException, InterruptedException {

        StringBuilder query = new StringBuilder("files?select=*");

        if (q != null && !q.isBlank()) {
            query.append("&filename=ilike.%25").append(URLEncoder.encode(q, StandardCharsets.UTF_8)).append("%25");
        }
        if (kind != null && !kind.equals("all")) {
            query.append("&kind=eq.").append(URLEncoder.encode(kind, StandardCharsets.UTF_8));
        }
        if (folderIdIsNull) {
            query.append("&folder_id=is.null");
        } else if (folderId != null) {
            query.append("&folder_id=eq.").append(URLEncoder.encode(folderId, StandardCharsets.UTF_8));
        }

        // Sort
        String orderCol = "created_at";
        boolean ascending = false;
        if (sort != null) {
            switch (sort) {
                case "created_asc" -> { orderCol = "created_at"; ascending = true; }
                case "name_asc" -> { orderCol = "filename"; ascending = true; }
                case "name_desc" -> { orderCol = "filename"; ascending = false; }
                case "size_desc" -> { orderCol = "size_bytes"; ascending = false; }
                case "size_asc" -> { orderCol = "size_bytes"; ascending = true; }
                default -> { orderCol = "created_at"; ascending = false; }
            }
        }
        query.append("&order=").append(orderCol).append(ascending ? ".asc" : ".desc");
        query.append("&limit=500");

        HttpRequest request = baseRequest(query.toString()).GET().build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IOException("Supabase listFiles error: " + response.statusCode() + " " + response.body());
        }
        return parseFileRows(response.body());
    }

    // ─── Get file by id ────────────────────────────────────────────────────────

    public FileRow getFile(String id) throws IOException, InterruptedException {
        HttpRequest request = baseRequest("files?id=eq." + URLEncoder.encode(id, StandardCharsets.UTF_8) + "&select=*")
                .GET()
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IOException("Supabase getFile error: " + response.statusCode());
        }
        List<FileRow> rows = parseFileRows(response.body());
        return rows.isEmpty() ? null : rows.get(0);
    }

    // ─── Find duplicate ────────────────────────────────────────────────────────

    public FileRow findDuplicateFile(String filename, long sizeBytes, String folderId, boolean folderIdIsNull)
            throws IOException, InterruptedException {

        StringBuilder query = new StringBuilder("files?select=*");
        query.append("&filename=eq.").append(URLEncoder.encode(filename, StandardCharsets.UTF_8));
        query.append("&size_bytes=eq.").append(sizeBytes);
        if (folderIdIsNull) {
            query.append("&folder_id=is.null");
        } else if (folderId != null) {
            query.append("&folder_id=eq.").append(URLEncoder.encode(folderId, StandardCharsets.UTF_8));
        }
        query.append("&limit=1");

        HttpRequest request = baseRequest(query.toString()).GET().build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IOException("Supabase findDuplicate error: " + response.statusCode());
        }
        List<FileRow> rows = parseFileRows(response.body());
        return rows.isEmpty() ? null : rows.get(0);
    }

    // ─── Insert file ────────────────────────────────────────────────────────────

    public FileRow insertFile(Map<String, Object> row) throws IOException, InterruptedException {
        String body = objectMapper.writeValueAsString(row);
        HttpRequest request = baseRequest("files?select=*")
                .header("Prefer", "return=representation")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IOException("Supabase insertFile error: " + response.statusCode() + " " + response.body());
        }
        List<FileRow> rows = parseFileRows(response.body());
        return rows.isEmpty() ? null : rows.get(0);
    }

    // ─── Update file ────────────────────────────────────────────────────────────

    public FileRow updateFile(String id, Map<String, Object> patch) throws IOException, InterruptedException {
        String body = objectMapper.writeValueAsString(patch);
        String path = "files?id=eq." + URLEncoder.encode(id, StandardCharsets.UTF_8) + "&select=*";
        HttpRequest request = baseRequest(path)
                .header("Prefer", "return=representation")
                .method("PATCH", HttpRequest.BodyPublishers.ofString(body))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IOException("Supabase updateFile error: " + response.statusCode() + " " + response.body());
        }
        List<FileRow> rows = parseFileRows(response.body());
        return rows.isEmpty() ? null : rows.get(0);
    }

    // ─── Delete file ────────────────────────────────────────────────────────────

    public void deleteFileRow(String id) throws IOException, InterruptedException {
        HttpRequest request = baseRequest("files?id=eq." + URLEncoder.encode(id, StandardCharsets.UTF_8))
                .DELETE()
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IOException("Supabase deleteFile error: " + response.statusCode());
        }
    }
}
