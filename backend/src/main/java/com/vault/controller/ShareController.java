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
import java.time.Instant;
import java.time.temporal.ChronoUnit;
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
            FolderRow folder = foldersDb.getFolder(id);
            if (folder == null) return ResponseEntity.notFound().build();

            boolean forceNew = Boolean.TRUE.equals(body.get("force_new"));
            boolean allowUpload = Boolean.TRUE.equals(body.getOrDefault("allow_upload", true));
            boolean allowDownload = Boolean.TRUE.equals(body.getOrDefault("allow_download", true));
            String label = (String) body.get("label");

            String expiresIn = (String) body.get("expires_in");
            String expiresAt = (String) body.get("expires_at");
            if (expiresIn != null && !expiresIn.equals("never")) {
                long hours = switch (expiresIn) {
                    case "24h" -> 24L;
                    case "7d" -> 7L * 24;
                    case "30d" -> 30L * 24;
                    default -> 0L;
                };
                if (hours > 0) {
                    expiresAt = Instant.now().plus(hours, ChronoUnit.HOURS).toString();
                }
            } else if ("never".equals(expiresIn)) {
                expiresAt = null;
            }

            if (!forceNew) {
                FolderShareRow existing = sharesDb.getActiveFolderShare(id);
                if (existing != null) {
                    Map<String, Object> opts = new HashMap<>();
                    if (label != null) opts.put("label", label);
                    opts.put("allow_upload", allowUpload);
                    opts.put("allow_download", allowDownload);
                    if (expiresIn != null || body.containsKey("expires_at")) {
                        opts.put("expires_at", expiresAt);
                    }
                    FolderShareRow updated = sharesDb.updateFolderShare(existing.getId(), opts);
                    return ResponseEntity.ok(Map.of("share", updated != null ? updated : existing, "reused", true));
                }
            }

            FolderShareRow share = sharesDb.createFolderShare(id, label, allowUpload, allowDownload, expiresAt);
            return ResponseEntity.ok(Map.of("share", share, "reused", false));
        } catch (Exception e) {
            log.error("createOrUpdateShare error", e);
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @PatchMapping("/api/folders/{id}/share")
    public ResponseEntity<?> patchShare(
            @PathVariable String id,
            @RequestBody Map<String, Object> body,
            HttpServletRequest request) {

        if (!auth.isUnlocked(request)) return ResponseEntity.status(401).body(Map.of("error", "locked"));
        try {
            String shareId = (String) body.get("shareId");
            if (shareId == null) shareId = (String) body.get("share_id");
            if (shareId == null) return ResponseEntity.badRequest().body(Map.of("error", "shareId required"));

            FolderShareRow share = sharesDb.getFolderShare(shareId);
            if (share == null || !id.equals(share.getFolderId())) {
                return ResponseEntity.status(404).body(Map.of("error", "Share not found"));
            }

            Map<String, Object> opts = new HashMap<>();
            if (body.containsKey("label")) opts.put("label", body.get("label"));
            if (body.containsKey("allow_upload")) opts.put("allow_upload", body.get("allow_upload"));
            if (body.containsKey("allow_download")) opts.put("allow_download", body.get("allow_download"));

            String expiresIn = (String) body.get("expires_in");
            if (expiresIn != null) {
                if ("never".equals(expiresIn)) {
                    opts.put("expires_at", null);
                } else {
                    long hours = switch (expiresIn) {
                        case "24h" -> 24L;
                        case "7d" -> 7L * 24;
                        case "30d" -> 30L * 24;
                        default -> 0L;
                    };
                    if (hours > 0) {
                        opts.put("expires_at", Instant.now().plus(hours, ChronoUnit.HOURS).toString());
                    }
                }
            } else if (body.containsKey("expires_at")) {
                opts.put("expires_at", body.get("expires_at"));
            }

            FolderShareRow updated = sharesDb.updateFolderShare(shareId, opts);
            return ResponseEntity.ok(Map.of("share", updated != null ? updated : share));
        } catch (Exception e) {
            log.error("patchShare error", e);
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/api/folders/{id}/share")
    public ResponseEntity<?> revokeShare(
            @PathVariable String id,
            @RequestParam(name = "shareId", required = false) String shareIdParam,
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest request) {

        if (!auth.isUnlocked(request)) return ResponseEntity.status(401).body(Map.of("error", "locked"));
        try {
            String shareId = shareIdParam;
            if (shareId == null && body != null) {
                shareId = (String) body.get("share_id");
                if (shareId == null) shareId = (String) body.get("shareId");
            }
            if (shareId == null) return ResponseEntity.badRequest().body(Map.of("error", "shareId required"));

            FolderShareRow share = sharesDb.getFolderShare(shareId);
            if (share == null || !id.equals(share.getFolderId())) {
                return ResponseEntity.status(404).body(Map.of("error", "Share not found"));
            }
            sharesDb.revokeFolderShare(shareId);
            return ResponseEntity.ok(Map.of("ok", true));
        } catch (Exception e) {
            log.error("revokeShare error", e);
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
            String folderId = (String) body.get("folder_id");
            boolean folderIdIsNull = folderId == null || folderId.equals("null") || folderId.isBlank();

            if (body.containsKey("files")) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> files = (List<Map<String, Object>>) body.get("files");
                List<Integer> duplicateIndexes = new ArrayList<>();
                if (files != null) {
                    for (int i = 0; i < files.size(); i++) {
                        Map<String, Object> fileInfo = files.get(i);
                        if (fileInfo == null) continue;
                        String fname = (String) fileInfo.get("filename");
                        Number sizeNum = (Number) fileInfo.get("size");
                        long fsize = sizeNum != null ? sizeNum.longValue() : 0L;
                        if (fname != null) {
                            FileRow dup = filesDb.findDuplicateFile(fname, fsize, folderIdIsNull ? null : folderId, folderIdIsNull);
                            if (dup != null) {
                                duplicateIndexes.add(i);
                            }
                        }
                    }
                }
                return ResponseEntity.ok(Map.of("duplicateIndexes", duplicateIndexes));
            }

            String filename = (String) body.get("filename");
            Number sizeNum = (Number) body.get("size");
            long size = sizeNum != null ? sizeNum.longValue() : 0L;

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
            log.error("uploadCheck error", e);
            return ResponseEntity.status(500).body(errorMap(e));
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
    public ResponseEntity<?> getShare(
            @PathVariable String token,
            @RequestParam(name = "folder_id", required = false) String folderIdParam,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String kind,
            @RequestParam(required = false) String sort) {
        try {
            FolderShareRow share = sharesDb.validateShareToken(token);
            if (share == null) return ResponseEntity.status(404).body(Map.of("error", "share not found or expired"));
            FolderRow rootFolder = foldersDb.getFolder(share.getFolderId());
            if (rootFolder == null) return ResponseEntity.status(404).body(Map.of("error", "root folder not found"));

            String targetFolderId = share.getFolderId();
            if (folderIdParam != null && !folderIdParam.isBlank() && !"root".equals(folderIdParam) && !folderIdParam.equals(share.getFolderId())) {
                if (foldersDb.isFolderDescendantOf(folderIdParam, share.getFolderId())) {
                    targetFolderId = folderIdParam;
                }
            }

            FolderRow currentFolder = foldersDb.getFolder(targetFolderId);
            if (currentFolder == null) return ResponseEntity.status(404).body(Map.of("error", "folder not found"));

            List<FolderRow> breadcrumbs = foldersDb.getShareBreadcrumbs(targetFolderId, share.getFolderId());

            boolean isSearching = q != null && !q.isBlank();
            boolean isFilteringKind = kind != null && !kind.isBlank() && !"all".equalsIgnoreCase(kind);

            List<FolderRow> folders = (!isSearching && !isFilteringKind)
                    ? foldersDb.listFolders(targetFolderId, false)
                    : List.of();

            String sortKey = (sort != null && !sort.isBlank()) ? sort : "created_desc";
            List<FileRow> files = filesDb.listFiles(q, kind, sortKey, targetFolderId, false);

            List<Map<String, String>> crumbList = breadcrumbs.stream()
                    .map(b -> Map.of("id", b.getId(), "name", b.getName()))
                    .toList();

            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("rootFolder", Map.of("id", rootFolder.getId(), "name", rootFolder.getName()));
            resp.put("currentFolder", Map.of("id", currentFolder.getId(), "name", currentFolder.getName()));
            resp.put("folder", Map.of("id", currentFolder.getId(), "name", currentFolder.getName()));
            resp.put("breadcrumbs", crumbList);
            resp.put("permissions", Map.of(
                    "allow_upload", share.isAllowUpload(),
                    "allow_download", share.isAllowDownload()
            ));
            resp.put("expires_at", share.getExpiresAt());
            resp.put("folders", folders);
            resp.put("files", files);
            resp.put("share", share);

            return ResponseEntity.ok(resp);
        } catch (Exception e) {
            log.error("getShare error", e);
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

            String folderId = (String) body.getOrDefault("folder_id", share.getFolderId());
            boolean folderIdIsNull = folderId == null || folderId.equals("null") || folderId.isBlank();

            if (body.containsKey("files")) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> files = (List<Map<String, Object>>) body.get("files");
                List<Integer> duplicateIndexes = new ArrayList<>();
                if (files != null) {
                    for (int i = 0; i < files.size(); i++) {
                        Map<String, Object> fileInfo = files.get(i);
                        if (fileInfo == null) continue;
                        String fname = (String) fileInfo.get("filename");
                        Number sizeNum = (Number) fileInfo.get("size");
                        long fsize = sizeNum != null ? sizeNum.longValue() : 0L;
                        if (fname != null) {
                            FileRow dup = filesDb.findDuplicateFile(fname, fsize, folderIdIsNull ? null : folderId, folderIdIsNull);
                            if (dup != null) {
                                duplicateIndexes.add(i);
                            }
                        }
                    }
                }
                return ResponseEntity.ok(Map.of("duplicateIndexes", duplicateIndexes));
            }

            String filename = (String) body.get("filename");
            Number sizeNum = (Number) body.get("size");
            long size = sizeNum != null ? sizeNum.longValue() : 0L;

            FileRow duplicate = filesDb.findDuplicateFile(filename, size, folderIdIsNull ? null : folderId, folderIdIsNull);
            if (duplicate != null) {
                return ResponseEntity.status(409).body(Map.of("error", "DUPLICATE_FILE", "existingFile", duplicate));
            }
            return ResponseEntity.ok(Map.of("ok", true));
        } catch (Exception e) {
            log.error("sharedUploadCheck error", e);
            return ResponseEntity.status(500).body(errorMap(e));
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
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletResponse response) throws IOException {

        try {
            FolderShareRow share = sharesDb.validateShareToken(token);
            if (share == null || !share.isAllowDownload()) {
                response.sendError(403, "not allowed");
                return;
            }

            @SuppressWarnings("unchecked")
            List<String> ids = body != null ? (List<String>) body.get("ids") : null;
            String folderId = body != null ? (String) body.get("folderId") : null;

            List<FileRow> files = new ArrayList<>();
            String zipArchiveName = "shared-download.zip";

            if (ids != null && !ids.isEmpty()) {
                ids = ids.stream().limit(200).toList();
                for (String fileId : ids) {
                    FileRow f = filesDb.getFile(fileId);
                    if (f != null && isFolderInShareTree(f.getFolderId(), share.getFolderId())) {
                        files.add(f);
                    }
                }
                FolderRow rootFolder = foldersDb.getFolder(share.getFolderId());
                if (rootFolder != null) {
                    zipArchiveName = rootFolder.getName() + "-" + files.size() + "-files.zip";
                }
            } else {
                // Folder download (target folderId or default to share root)
                String targetFolderId = (folderId != null && !folderId.isBlank()) ? folderId : share.getFolderId();
                if (!isFolderInShareTree(targetFolderId, share.getFolderId())) {
                    response.sendError(403, "forbidden");
                    return;
                }
                FolderRow targetFolder = foldersDb.getFolder(targetFolderId);
                if (targetFolder != null) {
                    zipArchiveName = targetFolder.getName() + ".zip";
                }

                // Collect files recursively within this folder
                List<String> queue = new ArrayList<>();
                queue.add(targetFolderId);
                int safetyLimit = 50;
                while (!queue.isEmpty() && safetyLimit-- > 0 && files.size() < 500) {
                    String curr = queue.remove(0);
                    List<FileRow> fList = filesDb.listFiles(null, null, "created_desc", curr, false);
                    files.addAll(fList);
                    List<FolderRow> subFolders = foldersDb.listFolders(curr, false);
                    for (FolderRow sf : subFolders) {
                        queue.add(sf.getId());
                    }
                }
            }

            if (files.isEmpty()) {
                response.sendError(404, "no files found");
                return;
            }

            String safeZipName = zipArchiveName.replaceAll("[\"\\\\]", "_");
            response.setContentType("application/zip");
            response.setHeader("Content-Disposition", "attachment; filename=\"" + safeZipName + "\"");
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

    private Map<String, Object> errorMap(Exception e) {
        String msg = e.getMessage();
        return Map.of("error", msg != null ? msg : e.getClass().getSimpleName());
    }
}
