package com.vault.controller;

import com.vault.model.FileRow;
import com.vault.model.FolderRow;
import com.vault.model.FolderShareRow;
import com.vault.service.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.*;

/**
 * Share + upload endpoints:
 * - GET/POST /api/folders/:id/share
 * - POST /api/upload-check
 * - POST /api/upload-chunk
 * - POST /api/upload-finalize
 * - GET/POST /api/shares/:token/*
 */
@RestController
public class ShareController {

    private static final Logger log = LoggerFactory.getLogger(ShareController.class);

    private final SharesDbService sharesDb;
    private final FoldersDbService foldersDb;
    private final FilesDbService filesDb;
    private final TelegramService telegram;
    private final AuthController auth;

    public ShareController(SharesDbService sharesDb, FoldersDbService foldersDb,
                            FilesDbService filesDb, TelegramService telegram, AuthController auth) {
        this.sharesDb = sharesDb;
        this.foldersDb = foldersDb;
        this.filesDb = filesDb;
        this.telegram = telegram;
        this.auth = auth;
    }

    // ─── Folder share management ──────────────────────────────────────────────

    @GetMapping("/api/folders/{id}/share")
    public ResponseEntity<?> listShares(@PathVariable String id, HttpServletRequest request) {
        if (!auth.isUnlocked(request)) return ResponseEntity.status(401).body(Map.of("error", "locked"));
        try {
            FolderRow folder = foldersDb.getFolder(id);
            if (folder == null) return ResponseEntity.notFound().build();
            List<FolderShareRow> shares = sharesDb.listFolderShares(id);
            return ResponseEntity.ok(Map.of("folder", folder, "shares", shares));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/api/folders/{id}/share")
    public ResponseEntity<?> createOrUpdateShare(
            @PathVariable String id,
            @RequestBody Map<String, Object> body,
            HttpServletRequest request) {

        if (!auth.isUnlocked(request)) return ResponseEntity.status(401).body(Map.of("error", "locked"));
        try {
            // If shareId provided, update; otherwise create
            String action = (String) body.getOrDefault("action", "create");
            if ("revoke".equals(action)) {
                String shareId = (String) body.get("share_id");
                sharesDb.revokeFolderShare(shareId);
                return ResponseEntity.ok(Map.of("ok", true));
            }
            if ("update".equals(action)) {
                String shareId = (String) body.get("share_id");
                Map<String, Object> opts = new HashMap<>();
                if (body.containsKey("label")) opts.put("label", body.get("label"));
                if (body.containsKey("allow_upload")) opts.put("allow_upload", body.get("allow_upload"));
                if (body.containsKey("allow_download")) opts.put("allow_download", body.get("allow_download"));
                if (body.containsKey("expires_at")) opts.put("expires_at", body.get("expires_at"));
                FolderShareRow updated = sharesDb.updateFolderShare(shareId, opts);
                return ResponseEntity.ok(updated);
            }
            // Create
            FolderRow folder = foldersDb.getFolder(id);
            if (folder == null) return ResponseEntity.notFound().build();

            // Prevent duplicate active shares
            FolderShareRow existing = sharesDb.getActiveFolderShare(id);
            if (existing != null) {
                return ResponseEntity.status(409).body(Map.of("error", "SHARE_EXISTS", "share", existing));
            }

            boolean allowUpload = Boolean.TRUE.equals(body.getOrDefault("allow_upload", true));
            boolean allowDownload = Boolean.TRUE.equals(body.getOrDefault("allow_download", true));
            String label = (String) body.get("label");
            String expiresAt = (String) body.get("expires_at");

            FolderShareRow share = sharesDb.createFolderShare(id, label, allowUpload, allowDownload, expiresAt);
            return ResponseEntity.ok(share);
        } catch (Exception e) {
            log.error("createOrUpdateShare error", e);
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    // ─── Authenticated upload ─────────────────────────────────────────────────

    @PostMapping("/api/upload-check")
    public ResponseEntity<?> uploadCheck(
            @RequestBody Map<String, Object> body,
            HttpServletRequest request) {

        if (!auth.isUnlocked(request)) return ResponseEntity.status(401).body(Map.of("error", "locked"));
        try {
            String filename = (String) body.get("filename");
            long size = ((Number) body.get("size")).longValue();
            String folderId = (String) body.get("folder_id");
            boolean folderIdIsNull = folderId == null || folderId.equals("null");

            FileRow duplicate = filesDb.findDuplicateFile(filename, size, folderIdIsNull ? null : folderId, folderIdIsNull);
            if (duplicate != null) {
                return ResponseEntity.status(409).body(Map.of(
                        "error", "DUPLICATE_FILE",
                        "message", "A file named \"" + filename + "\" (" + size + " bytes) already exists",
                        "existingFile", duplicate
                ));
            }
            return ResponseEntity.ok(Map.of("ok", true));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/api/upload-chunk")
    public ResponseEntity<?> uploadChunk(
            @RequestParam("blob") MultipartFile blob,
            @RequestParam(value = "filename", defaultValue = "file") String filename,
            @RequestParam(value = "mime", defaultValue = "application/octet-stream") String mime,
            @RequestParam(value = "index", defaultValue = "0") int index,
            @RequestParam(value = "totalParts", defaultValue = "1") int totalParts,
            HttpServletRequest request) {

        if (!auth.isUnlocked(request)) return ResponseEntity.status(401).body(Map.of("error", "locked"));
        try {
            byte[] bytes = blob.getBytes();
            boolean forceDocument = totalParts > 1;
            String partName = totalParts > 1 ? filename + ".part" + String.format("%04d", index) : filename;
            String caption = totalParts > 1 ? filename + " (part " + (index + 1) + "/" + totalParts + ")" : filename;

            Map<String, Object> result = sendFileToTelegram(bytes, partName, mime, caption, forceDocument);
            result.put("index", index);
            result.put("size", bytes.length);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("uploadChunk error", e);
            return ResponseEntity.status(502).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/api/upload-finalize")
    public ResponseEntity<?> uploadFinalize(
            @RequestBody Map<String, Object> body,
            HttpServletRequest request) {

        if (!auth.isUnlocked(request)) return ResponseEntity.status(401).body(Map.of("error", "locked"));
        return doFinalize(body);
    }

    // ─── Share token endpoints ────────────────────────────────────────────────

    @GetMapping("/api/shares/{token}")
    public ResponseEntity<?> getShare(@PathVariable String token) {
        try {
            FolderShareRow share = sharesDb.validateShareToken(token);
            if (share == null) return ResponseEntity.status(404).body(Map.of("error", "share not found or expired"));
            FolderRow folder = foldersDb.getFolder(share.getFolderId());
            List<FileRow> files = filesDb.listFiles(null, null, "created_desc", share.getFolderId(), false);
            List<FolderRow> subFolders = foldersDb.listFolders(share.getFolderId(), false);
            return ResponseEntity.ok(Map.of(
                    "share", share,
                    "folder", folder != null ? folder : Map.of(),
                    "files", files,
                    "subFolders", subFolders
            ));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/api/shares/{token}/files/{fileId}/stream")
    public void streamSharedFile(
            @PathVariable String token,
            @PathVariable String fileId,
            HttpServletRequest request,
            HttpServletResponse response) throws IOException {

        try {
            FolderShareRow share = sharesDb.validateShareToken(token);
            if (share == null || !share.isAllowDownload()) {
                response.sendError(403, "not allowed");
                return;
            }
            FileRow file = filesDb.getFile(fileId);
            if (file == null) {
                response.sendError(404);
                return;
            }
            // Verify file is in share's folder tree
            if (!isFolderInShareTree(file.getFolderId(), share.getFolderId())) {
                response.sendError(403);
                return;
            }

            List<FileRow.FilePart> parts = file.getParts().stream()
                    .sorted(Comparator.comparingInt(FileRow.FilePart::getIndex))
                    .toList();

            response.setContentType(file.getMime() != null ? file.getMime() : "application/octet-stream");
            response.setContentLengthLong(file.getSizeBytes());
            String dl = request.getParameter("dl");
            String disposition = (dl != null ? "attachment" : "inline") + "; filename=\"" + file.getFilename() + "\"";
            response.setHeader("Content-Disposition", disposition);

            try (OutputStream out = response.getOutputStream()) {
                for (FileRow.FilePart part : parts) {
                    try (InputStream is = telegram.fetchTelegramFile(part.getFileId(), null)) {
                        copyStream(is, out);
                    }
                }
            }
        } catch (Exception e) {
            log.error("streamSharedFile error", e);
            response.sendError(502, e.getMessage());
        }
    }

    @GetMapping("/api/shares/{token}/files/{fileId}/thumb")
    public void getSharedThumb(
            @PathVariable String token,
            @PathVariable String fileId,
            HttpServletResponse response) throws IOException {

        try {
            FolderShareRow share = sharesDb.validateShareToken(token);
            if (share == null) {
                response.sendError(403);
                return;
            }
            FileRow file = filesDb.getFile(fileId);
            if (file == null || file.getThumbFileId() == null) {
                response.sendError(404);
                return;
            }
            InputStream stream = telegram.fetchTelegramFile(file.getThumbFileId(), null);
            response.setContentType("image/jpeg");
            response.setHeader("Cache-Control", "private, max-age=3600");
            copyStream(stream, response.getOutputStream());
        } catch (Exception e) {
            response.sendError(502, e.getMessage());
        }
    }

    @PostMapping("/api/shares/{token}/upload-check")
    public ResponseEntity<?> sharedUploadCheck(
            @PathVariable String token,
            @RequestBody Map<String, Object> body) {

        try {
            FolderShareRow share = sharesDb.validateShareToken(token);
            if (share == null || !share.isAllowUpload()) return ResponseEntity.status(403).body(Map.of("error", "not allowed"));

            String filename = (String) body.get("filename");
            long size = ((Number) body.get("size")).longValue();
            String folderId = (String) body.getOrDefault("folder_id", share.getFolderId());
            boolean folderIdIsNull = folderId == null || folderId.equals("null");

            FileRow duplicate = filesDb.findDuplicateFile(filename, size, folderIdIsNull ? null : folderId, folderIdIsNull);
            if (duplicate != null) {
                return ResponseEntity.status(409).body(Map.of("error", "DUPLICATE_FILE", "existingFile", duplicate));
            }
            return ResponseEntity.ok(Map.of("ok", true));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/api/shares/{token}/upload-chunk")
    public ResponseEntity<?> sharedUploadChunk(
            @PathVariable String token,
            @RequestParam("blob") MultipartFile blob,
            @RequestParam(value = "filename", defaultValue = "file") String filename,
            @RequestParam(value = "mime", defaultValue = "application/octet-stream") String mime,
            @RequestParam(value = "index", defaultValue = "0") int index,
            @RequestParam(value = "totalParts", defaultValue = "1") int totalParts) {

        try {
            FolderShareRow share = sharesDb.validateShareToken(token);
            if (share == null || !share.isAllowUpload()) return ResponseEntity.status(403).body(Map.of("error", "not allowed"));

            byte[] bytes = blob.getBytes();
            boolean forceDocument = totalParts > 1;
            String partName = totalParts > 1 ? filename + ".part" + String.format("%04d", index) : filename;
            String caption = totalParts > 1 ? filename + " (part " + (index + 1) + "/" + totalParts + ")" : filename;

            Map<String, Object> result = sendFileToTelegram(bytes, partName, mime, caption, forceDocument);
            result.put("index", index);
            result.put("size", bytes.length);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.status(502).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/api/shares/{token}/upload-finalize")
    public ResponseEntity<?> sharedUploadFinalize(
            @PathVariable String token,
            @RequestBody Map<String, Object> body) {

        try {
            FolderShareRow share = sharesDb.validateShareToken(token);
            if (share == null || !share.isAllowUpload()) return ResponseEntity.status(403).body(Map.of("error", "not allowed"));

            // Override folder_id with share's folder if not set or not in share tree
            if (!body.containsKey("folder_id") || body.get("folder_id") == null) {
                body = new HashMap<>(body);
                body.put("folder_id", share.getFolderId());
            }
            return doFinalize(body);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/api/shares/{token}/create-folder")
    public ResponseEntity<?> sharedCreateFolder(
            @PathVariable String token,
            @RequestBody Map<String, Object> body) {

        try {
            FolderShareRow share = sharesDb.validateShareToken(token);
            if (share == null || !share.isAllowUpload()) return ResponseEntity.status(403).body(Map.of("error", "not allowed"));

            String name = (String) body.get("name");
            String parentId = (String) body.getOrDefault("parent_id", share.getFolderId());
            if (name == null || name.isBlank()) return ResponseEntity.badRequest().body(Map.of("error", "name required"));

            // Verify parent is in share tree
            if (!isFolderInShareTree(parentId, share.getFolderId())) {
                return ResponseEntity.status(403).body(Map.of("error", "folder not in share tree"));
            }
            FolderRow folder = foldersDb.createFolder(name, parentId);
            return ResponseEntity.ok(folder);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/api/shares/{token}/download-zip")
    public void sharedDownloadZip(
            @PathVariable String token,
            @RequestBody Map<String, Object> body,
            HttpServletResponse response) throws IOException {

        try {
            FolderShareRow share = sharesDb.validateShareToken(token);
            if (share == null || !share.isAllowDownload()) {
                response.sendError(403, "not allowed");
                return;
            }
            @SuppressWarnings("unchecked")
            List<String> ids = (List<String>) body.get("ids");
            if (ids == null || ids.isEmpty()) {
                response.sendError(400, "ids required");
                return;
            }
            ids = ids.stream().limit(100).toList();

            List<FileRow> files = new ArrayList<>();
            for (String fileId : ids) {
                FileRow f = filesDb.getFile(fileId);
                if (f != null && isFolderInShareTree(f.getFolderId(), share.getFolderId())) {
                    files.add(f);
                }
            }
            if (files.isEmpty()) {
                response.sendError(404, "no files found");
                return;
            }

            response.setContentType("application/zip");
            response.setHeader("Content-Disposition", "attachment; filename=\"shared-download.zip\"");
            response.setHeader("Cache-Control", "no-store");

            try (java.util.zip.ZipOutputStream zos = new java.util.zip.ZipOutputStream(response.getOutputStream())) {
                Map<String, Integer> seen = new HashMap<>();
                for (FileRow file : files) {
                    String base = file.getFilename().replaceAll("[\\\\/:*?\"<>|]", "_");
                    int count = seen.getOrDefault(base, 0);
                    seen.put(base, count + 1);
                    String entryName = count == 0 ? base : addSuffix(base, " (" + count + ")");
                    zos.putNextEntry(new java.util.zip.ZipEntry(entryName));
                    for (FileRow.FilePart part : file.getParts().stream()
                            .sorted(Comparator.comparingInt(FileRow.FilePart::getIndex)).toList()) {
                        try (InputStream is = telegram.fetchTelegramFile(part.getFileId(), null)) {
                            copyStream(is, zos);
                        }
                    }
                    zos.closeEntry();
                }
            }
        } catch (Exception e) {
            log.error("sharedDownloadZip error", e);
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Uploads bytes to Telegram and returns {file_id, message_id, thumb_file_id}.
     */
    private Map<String, Object> sendFileToTelegram(byte[] bytes, String filename, String mime,
                                                     String caption, boolean forceDocument)
            throws IOException, InterruptedException {

        // Use multipart/form-data to call Telegram sendDocument/sendPhoto/etc.
        String method = forceDocument ? "sendDocument"
                : pickSendMethod(mime);
        String fieldName = switch (method) {
            case "sendPhoto" -> "photo";
            case "sendVideo" -> "video";
            case "sendAudio" -> "audio";
            default -> "document";
        };

        // Build multipart request manually using Java HttpClient
        String chatId = telegram.getChatId();
        String boundary = "----VaultBoundary" + System.nanoTime();
        String token = System.getProperty("TELEGRAM_BOT_TOKEN");
        String url = "https://api.telegram.org/bot" + token + "/" + method;

        byte[] body = buildMultipart(boundary, chatId, caption, fieldName, filename, mime, bytes);

        java.net.http.HttpClient client = java.net.http.HttpClient.newHttpClient();
        java.net.http.HttpRequest req = java.net.http.HttpRequest.newBuilder()
                .uri(java.net.URI.create(url))
                .timeout(java.time.Duration.ofSeconds(120))
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .POST(java.net.http.HttpRequest.BodyPublishers.ofByteArray(body))
                .build();

        java.net.http.HttpResponse<String> resp = client.send(req, java.net.http.HttpResponse.BodyHandlers.ofString());
        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        com.fasterxml.jackson.databind.JsonNode json = mapper.readTree(resp.body());

        if (!json.path("ok").asBoolean()) {
            throw new IOException("Telegram " + method + " failed: " + json.path("description").asText());
        }

        com.fasterxml.jackson.databind.JsonNode result = json.path("result");
        long messageId = result.path("message_id").asLong();
        String fileId = extractFileId(result, fieldName);
        String thumbFileId = extractThumbId(result);

        Map<String, Object> out = new HashMap<>();
        out.put("file_id", fileId);
        out.put("message_id", messageId);
        out.put("thumb_file_id", thumbFileId);
        return out;
    }

    private String extractFileId(com.fasterxml.jackson.databind.JsonNode result, String fieldName) {
        com.fasterxml.jackson.databind.JsonNode photo = result.path("photo");
        if (photo.isArray() && photo.size() > 0) {
            return photo.get(photo.size() - 1).path("file_id").asText();
        }
        com.fasterxml.jackson.databind.JsonNode doc = result.path("document");
        if (!doc.isMissingNode()) return doc.path("file_id").asText();
        com.fasterxml.jackson.databind.JsonNode video = result.path("video");
        if (!video.isMissingNode()) return video.path("file_id").asText();
        com.fasterxml.jackson.databind.JsonNode audio = result.path("audio");
        if (!audio.isMissingNode()) return audio.path("file_id").asText();
        return "";
    }

    private String extractThumbId(com.fasterxml.jackson.databind.JsonNode result) {
        com.fasterxml.jackson.databind.JsonNode photo = result.path("photo");
        if (photo.isArray() && photo.size() > 0) {
            return photo.get(0).path("file_id").asText(null);
        }
        for (String field : new String[]{"document", "video", "audio"}) {
            com.fasterxml.jackson.databind.JsonNode doc = result.path(field);
            String thumb = doc.path("thumbnail").path("file_id").asText(null);
            if (thumb == null) thumb = doc.path("thumb").path("file_id").asText(null);
            if (thumb != null) return thumb;
        }
        return null;
    }

    private String pickSendMethod(String mime) {
        if (mime.startsWith("image/") && !mime.equals("image/gif") && !mime.equals("image/svg+xml")) return "sendPhoto";
        if (mime.startsWith("video/")) return "sendVideo";
        if (mime.startsWith("audio/")) return "sendAudio";
        return "sendDocument";
    }

    private byte[] buildMultipart(String boundary, String chatId, String caption,
                                   String fieldName, String filename, String mime, byte[] bytes)
            throws IOException {

        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        String CRLF = "\r\n";
        String dash = "--";

        // chat_id
        baos.write((dash + boundary + CRLF).getBytes());
        baos.write(("Content-Disposition: form-data; name=\"chat_id\"" + CRLF + CRLF).getBytes());
        baos.write((chatId + CRLF).getBytes());

        // caption
        if (caption != null) {
            baos.write((dash + boundary + CRLF).getBytes());
            baos.write(("Content-Disposition: form-data; name=\"caption\"" + CRLF + CRLF).getBytes());
            baos.write((caption + CRLF).getBytes());
        }

        // file blob
        baos.write((dash + boundary + CRLF).getBytes());
        baos.write(("Content-Disposition: form-data; name=\"" + fieldName + "\"; filename=\"" + filename + "\"" + CRLF).getBytes());
        baos.write(("Content-Type: " + mime + CRLF + CRLF).getBytes());
        baos.write(bytes);
        baos.write(CRLF.getBytes());

        // closing boundary
        baos.write((dash + boundary + dash + CRLF).getBytes());

        return baos.toByteArray();
    }

    private ResponseEntity<?> doFinalize(Map<String, Object> body) {
        try {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> rawParts = (List<Map<String, Object>>) body.get("parts");
            String filename = (String) body.get("filename");
            String mime = (String) body.getOrDefault("mime", "application/octet-stream");
            long size = ((Number) body.get("size")).longValue();
            String thumbFileId = (String) body.get("thumb_file_id");
            String folderId = (String) body.get("folder_id");
            boolean allowDuplicate = Boolean.TRUE.equals(body.get("allow_duplicate"));

            // Sort parts
            List<Map<String, Object>> parts = new ArrayList<>(rawParts);
            parts.sort(Comparator.comparingInt(p -> ((Number) p.get("index")).intValue()));

            // Duplicate check
            if (!allowDuplicate) {
                boolean folderIsNull = folderId == null || folderId.equals("null");
                FileRow duplicate = filesDb.findDuplicateFile(filename, size, folderIsNull ? null : folderId, folderIsNull);
                if (duplicate != null) {
                    return ResponseEntity.status(409).body(Map.of(
                            "error", "DUPLICATE_FILE",
                            "message", "A file named \"" + filename + "\" (" + size + " bytes) already exists",
                            "existingFile", duplicate
                    ));
                }
            }

            // Build parts list for DB
            List<FileRow.FilePart> fileParts = parts.stream().map(p -> FileRow.FilePart.builder()
                    .index(((Number) p.get("index")).intValue())
                    .fileId((String) p.get("file_id"))
                    .messageId(((Number) p.get("message_id")).longValue())
                    .size(((Number) p.get("size")).longValue())
                    .build()
            ).toList();

            Map<String, Object> row = new HashMap<>();
            row.put("filename", filename);
            row.put("mime", mime != null ? mime : "application/octet-stream");
            row.put("size_bytes", size);
            row.put("kind", TelegramService.kindFromMime(mime != null ? mime : ""));
            row.put("parts", fileParts);
            row.put("tags", List.of());
            row.put("thumb_file_id", thumbFileId);
            row.put("folder_id", (folderId == null || "null".equals(folderId)) ? null : folderId);

            FileRow file = filesDb.insertFile(row);
            return ResponseEntity.ok(Map.of("file", file));
        } catch (Exception e) {
            log.error("doFinalize error", e);
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    private boolean isFolderInShareTree(String folderId, String rootFolderId) {
        if (folderId == null) return false;
        if (folderId.equals(rootFolderId)) return true;
        try {
            return foldersDb.isFolderDescendantOf(folderId, rootFolderId);
        } catch (Exception e) {
            return false;
        }
    }

    private void copyStream(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
        }
    }

    private String addSuffix(String filename, String suffix) {
        int dot = filename.lastIndexOf('.');
        if (dot > 0) return filename.substring(0, dot) + suffix + filename.substring(dot);
        return filename + suffix;
    }
}
