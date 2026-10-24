package com.vault.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.vault.model.FolderRow;
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
 * Java port of folders-db.server.ts
 */
@Service
public class FoldersDbService {

    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public FoldersDbService(ObjectMapper objectMapper) {
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

    private List<FolderRow> parseFolderRows(String body) throws IOException {
        JsonNode arr = objectMapper.readTree(body);
        List<FolderRow> rows = new ArrayList<>();
        for (JsonNode node : arr) {
            rows.add(objectMapper.treeToValue(node, FolderRow.class));
        }
        return rows;
    }

    public List<FolderRow> listFolders(String parentId, boolean parentIsNull)
            throws IOException, InterruptedException {

        StringBuilder query = new StringBuilder("folders?select=*");
        if (parentIsNull) {
            query.append("&parent_id=is.null");
        } else if (parentId != null) {
            query.append("&parent_id=eq.").append(URLEncoder.encode(parentId, StandardCharsets.UTF_8));
        }
        query.append("&order=name.asc");

        HttpRequest request = baseRequest(query.toString()).GET().build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IOException("Supabase listFolders error: " + response.statusCode());
        }
        return parseFolderRows(response.body());
    }

    public FolderRow getFolder(String id) throws IOException, InterruptedException {
        HttpRequest request = baseRequest("folders?id=eq." + URLEncoder.encode(id, StandardCharsets.UTF_8) + "&select=*")
                .GET().build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IOException("Supabase getFolder error: " + response.statusCode());
        }
        List<FolderRow> rows = parseFolderRows(response.body());
        return rows.isEmpty() ? null : rows.get(0);
    }

    public FolderRow createFolder(String name, String parentId)
            throws IOException, InterruptedException {

        Map<String, Object> row = parentId != null
                ? Map.of("name", name, "parent_id", parentId)
                : Map.of("name", name);

        HttpRequest request = baseRequest("folders?select=*")
                .header("Prefer", "return=representation")
                .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(row)))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IOException("Supabase createFolder error: " + response.statusCode() + " " + response.body());
        }
        List<FolderRow> rows = parseFolderRows(response.body());
        return rows.isEmpty() ? null : rows.get(0);
    }

    public FolderRow renameFolder(String id, String name) throws IOException, InterruptedException {
        Map<String, Object> patch = Map.of("name", name);
        HttpRequest request = baseRequest("folders?id=eq." + URLEncoder.encode(id, StandardCharsets.UTF_8) + "&select=*")
                .header("Prefer", "return=representation")
                .method("PATCH", HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(patch)))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IOException("Supabase renameFolder error: " + response.statusCode());
        }
        List<FolderRow> rows = parseFolderRows(response.body());
        return rows.isEmpty() ? null : rows.get(0);
    }

    public void deleteFolder(String id) throws IOException, InterruptedException {
        HttpRequest request = baseRequest("folders?id=eq." + URLEncoder.encode(id, StandardCharsets.UTF_8))
                .DELETE().build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IOException("Supabase deleteFolder error: " + response.statusCode());
        }
    }

    public List<FolderRow> getFolderBreadcrumbs(String id) throws IOException, InterruptedException {
        List<FolderRow> crumbs = new ArrayList<>();
        String currentId = id;
        int depth = 0;
        while (currentId != null && depth < 50) {
            depth++;
            FolderRow folder = getFolder(currentId);
            if (folder == null) break;
            crumbs.add(0, folder);
            currentId = folder.getParentId();
        }
        return crumbs;
    }

    public List<FolderRow> getShareBreadcrumbs(String currentFolderId, String rootFolderId)
            throws IOException, InterruptedException {

        List<FolderRow> crumbs = new ArrayList<>();
        String currentId = currentFolderId;
        int depth = 0;
        while (currentId != null && depth < 50) {
            depth++;
            FolderRow folder = getFolder(currentId);
            if (folder == null) break;
            crumbs.add(0, folder);
            if (folder.getId().equals(rootFolderId)) break;
            currentId = folder.getParentId();
        }
        return crumbs;
    }

    public boolean isFolderDescendantOf(String folderId, String ancestorId)
            throws IOException, InterruptedException {

        if (folderId.equals(ancestorId)) return true;
        String currentId = folderId;
        int depth = 0;
        while (currentId != null && depth < 50) {
            depth++;
            FolderRow folder = getFolder(currentId);
            if (folder == null || folder.getParentId() == null) return false;
            if (folder.getParentId().equals(ancestorId)) return true;
            currentId = folder.getParentId();
        }
        return false;
    }
}
