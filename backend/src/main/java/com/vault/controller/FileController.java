package com.vault.controller;

import com.vault.model.FileRow;
import com.vault.service.FilesDbService;
import com.vault.service.TelegramService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * File endpoints — list, get, stream, thumbnail, download-zip, delete, rename/move.
 * Ports: api/files.ts, api/files.$id.ts, api/files.$id.stream.ts,
 *        api/files.$id.thumb.ts, api/files.download-zip.ts, api/files.$id.link.ts
 */
@RestController
@RequestMapping("/api/files")
public class FileController {

    private static final Logger log = LoggerFactory.getLogger(FileController.class);

    private final FilesDbService filesDb;
    private final TelegramService telegram;
    private final AuthController auth;

    public FileController(FilesDbService filesDb, TelegramService telegram, AuthController auth) {
        this.filesDb = filesDb;
        this.telegram = telegram;
        this.auth = auth;
    }

    // ─── List files ────────────────────────────────────────────────────────────

    @GetMapping
    public ResponseEntity<?> listFiles(
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String kind,
            @RequestParam(required = false) String sort,
            @RequestParam(name = "folder_id", required = false) String folderId,
            HttpServletRequest request) {

        if (!auth.isUnlocked(request)) return ResponseEntity.status(401).body(Map.of("error", "locked"));
        try {
            boolean isNull = folderId != null && folderId.equals("null");
            String resolvedFolderId = isNull ? null : folderId;
            boolean folderIdIsNull = isNull || (folderId != null && folderId.isBlank());
            // If folder_id param exists but is empty/null-string → show root
            boolean useNull = folderId != null;

            List<FileRow> files = filesDb.listFiles(q, kind, sort, resolvedFolderId, useNull && isNull);
            return ResponseEntity.ok(files);
        } catch (Exception e) {
            log.error("listFiles error", e);
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    // ─── Get file ──────────────────────────────────────────────────────────────

    @GetMapping("/{id}")
    public ResponseEntity<?> getFile(@PathVariable String id, HttpServletRequest request) {
        if (!auth.isUnlocked(request)) return ResponseEntity.status(401).body(Map.of("error", "locked"));
        try {
            FileRow file = filesDb.getFile(id);
            if (file == null) return ResponseEntity.notFound().build();
            return ResponseEntity.ok(file);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    // ─── Stream file ───────────────────────────────────────────────────────────

    @GetMapping("/{id}/stream")
    public void streamFile(
            @PathVariable String id,
            HttpServletRequest request,
            HttpServletResponse response) throws IOException {

        if (!auth.isUnlocked(request)) {
            response.sendError(401, "unauthorized");
            return;
        }
        FileRow file;
        try {
            file = filesDb.getFile(id);
        } catch (Exception e) {
            response.sendError(500, e.getMessage());
            return;
        }
        if (file == null) {
            response.sendError(404, "not found");
            return;
        }

        String rangeHeader = request.getHeader("Range");
        long totalSize = file.getSizeBytes();

        // Content-Disposition
        String safeAscii = file.getFilename().replaceAll("[\"\\\\]", "_").replaceAll("[^\\x20-\\x7E]", "_");
        String encoded = URLEncoder.encode(file.getFilename(), StandardCharsets.UTF_8);
        String dispositionType = request.getParameter("dl") != null ? "attachment" : "inline";
        String disposition = dispositionType + "; filename=\"" + safeAscii + "\"; filename*=UTF-8''" + encoded;

        // Simple single-part, no Range: fast-path
        if (rangeHeader == null && file.getParts().size() == 1) {
            try {
                InputStream stream = telegram.fetchTelegramFile(file.getParts().get(0).getFileId(), null);
                response.setContentType(file.getMime() != null ? file.getMime() : "application/octet-stream");
                response.setContentLengthLong(totalSize);
                response.setHeader("Content-Disposition", disposition);
                response.setHeader("Cache-Control", "private, no-transform, max-age=600");
                response.setHeader("Accept-Ranges", "bytes");
                response.setHeader("X-Content-Type-Options", "nosniff");
                copyStream(stream, response.getOutputStream());
                return;
            } catch (Exception e) {
                log.warn("Fast-path stream failed, falling through: {}", e.getMessage());
            }
        }

        // Multi-part or range: stream first matching part (simplified)
        List<FileRow.FilePart> parts = file.getParts().stream()
                .sorted(java.util.Comparator.comparingInt(FileRow.FilePart::getIndex))
                .toList();

        if (rangeHeader != null) {
            // Parse range
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("^bytes=(\\d+)-(\\d+)?$")
                    .matcher(rangeHeader);
            if (!m.matches()) {
                response.setStatus(416);
                response.setHeader("Content-Range", "bytes */" + totalSize);
                return;
            }
            long start = Long.parseLong(m.group(1));
            long end = m.group(2) != null ? Long.parseLong(m.group(2)) : totalSize - 1;
            if (start < 0 || end >= totalSize || start > end) {
                response.setStatus(416);
                response.setHeader("Content-Range", "bytes */" + totalSize);
                return;
            }

            // Find which part contains the start offset
            long offset = 0;
            for (FileRow.FilePart part : parts) {
                long partEnd = offset + part.getSize();
                if (start >= offset && start < partEnd) {
                    long partRangeStart = start - offset;
                    long partRangeEnd = Math.min(end - offset, part.getSize() - 1);
                    String partRange = "bytes=" + partRangeStart + "-" + partRangeEnd;
                    try {
                        InputStream stream = telegram.fetchTelegramFile(part.getFileId(), partRange);
                        long length = end - start + 1;
                        response.setStatus(206);
                        response.setContentType(file.getMime() != null ? file.getMime() : "application/octet-stream");
                        response.setContentLengthLong(length);
                        response.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + totalSize);
                        response.setHeader("Content-Disposition", disposition);
                        response.setHeader("Accept-Ranges", "bytes");
                        copyStream(stream, response.getOutputStream());
                        return;
                    } catch (Exception e) {
                        log.error("Range stream failed", e);
                        response.sendError(502, "stream error");
                        return;
                    }
                }
                offset += part.getSize();
            }
            response.sendError(416);
        } else {
            // Stream all parts sequentially
            response.setContentType(file.getMime() != null ? file.getMime() : "application/octet-stream");
            response.setContentLengthLong(totalSize);
            response.setHeader("Content-Disposition", disposition);
            response.setHeader("Accept-Ranges", "bytes");
            response.setHeader("Cache-Control", "private, no-transform, max-age=600");
            OutputStream out = response.getOutputStream();
            for (FileRow.FilePart part : parts) {
                try {
                    InputStream stream = telegram.fetchTelegramFile(part.getFileId(), null);
                    copyStream(stream, out);
                } catch (Exception e) {
                    log.error("Multi-part stream error at part {}", part.getIndex(), e);
                    break;
                }
            }
        }
    }

    // ─── Thumbnail ─────────────────────────────────────────────────────────────

    @GetMapping("/{id}/thumb")
    public void getThumb(
            @PathVariable String id,
            HttpServletRequest request,
            HttpServletResponse response) throws IOException {

        if (!auth.isUnlocked(request)) {
            response.sendError(401);
            return;
        }
        try {
            FileRow file = filesDb.getFile(id);
            if (file == null || file.getThumbFileId() == null) {
                response.sendError(404);
                return;
            }
            InputStream stream = telegram.fetchTelegramFile(file.getThumbFileId(), null);
            response.setContentType("image/jpeg");
            response.setHeader("Cache-Control", "private, max-age=3600");
            copyStream(stream, response.getOutputStream());
        } catch (Exception e) {
            log.error("thumb error", e);
            response.sendError(502, e.getMessage());
        }
    }

    // ─── Signed download link ──────────────────────────────────────────────────

    @GetMapping("/{id}/link")
    public ResponseEntity<?> getLink(@PathVariable String id, HttpServletRequest request) {
        if (!auth.isUnlocked(request)) return ResponseEntity.status(401).body(Map.of("error", "locked"));
        try {
            FileRow file = filesDb.getFile(id);
            if (file == null) return ResponseEntity.notFound().build();
            // Return a direct stream URL (same-origin, cookies will be sent)
            String url = "/api/files/" + id + "/stream?dl=1";
            return ResponseEntity.ok(Map.of("url", url, "filename", file.getFilename()));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    // ─── Delete file ────────────────────────────────────────────────────────────

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteFile(@PathVariable String id, HttpServletRequest request) {
        if (!auth.isUnlocked(request)) return ResponseEntity.status(401).body(Map.of("error", "locked"));
        try {
            FileRow file = filesDb.getFile(id);
            if (file == null) return ResponseEntity.notFound().build();
            // Delete from Telegram (best-effort)
            for (FileRow.FilePart part : file.getParts()) {
                telegram.deleteMessage(part.getMessageId());
            }
            filesDb.deleteFileRow(id);
            return ResponseEntity.ok(Map.of("ok", true));
        } catch (Exception e) {
            log.error("deleteFile error", e);
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    // ─── Update (rename/move) ──────────────────────────────────────────────────

    @PatchMapping("/{id}")
    public ResponseEntity<?> updateFile(
            @PathVariable String id,
            @RequestBody Map<String, Object> body,
            HttpServletRequest request) {

        if (!auth.isUnlocked(request)) return ResponseEntity.status(401).body(Map.of("error", "locked"));
        try {
            java.util.Map<String, Object> patch = new java.util.HashMap<>();
            if (body.containsKey("filename")) patch.put("filename", body.get("filename"));
            if (body.containsKey("folder_id")) patch.put("folder_id", body.get("folder_id"));
            if (body.containsKey("tags")) patch.put("tags", body.get("tags"));
            FileRow updated = filesDb.updateFile(id, patch);
            return ResponseEntity.ok(updated);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    // ─── Download ZIP ──────────────────────────────────────────────────────────

    @PostMapping("/download-zip")
    public void downloadZip(
            @RequestBody Map<String, Object> body,
            HttpServletRequest request,
            HttpServletResponse response) throws IOException {

        if (!auth.isUnlocked(request)) {
            response.sendError(401);
            return;
        }
        try {
            @SuppressWarnings("unchecked")
            List<String> ids = (List<String>) body.get("ids");
            if (ids == null || ids.isEmpty()) {
                response.sendError(400, "ids must be a non-empty array");
                return;
            }
            ids = ids.stream().limit(100).toList();

            List<FileRow> files = new java.util.ArrayList<>();
            for (String fileId : ids) {
                FileRow f = filesDb.getFile(fileId);
                if (f != null) files.add(f);
            }
            if (files.isEmpty()) {
                response.sendError(404, "no files found");
                return;
            }

            response.setContentType("application/zip");
            response.setHeader("Content-Disposition", "attachment; filename=\"vault-download.zip\"");
            response.setHeader("Cache-Control", "no-store");

            // Write a simple ZIP using Java's built-in ZipOutputStream
            try (java.util.zip.ZipOutputStream zos = new java.util.zip.ZipOutputStream(response.getOutputStream())) {
                java.util.Map<String, Integer> seen = new java.util.HashMap<>();
                for (FileRow file : files) {
                    String base = file.getFilename().replaceAll("[\\\\/:*?\"<>|]", "_");
                    int count = seen.getOrDefault(base, 0);
                    seen.put(base, count + 1);
                    String entryName = count == 0 ? base : addSuffix(base, " (" + count + ")");

                    zos.putNextEntry(new java.util.zip.ZipEntry(entryName));
                    List<FileRow.FilePart> parts = file.getParts().stream()
                            .sorted(java.util.Comparator.comparingInt(FileRow.FilePart::getIndex))
                            .toList();
                    for (FileRow.FilePart part : parts) {
                        try (InputStream is = telegram.fetchTelegramFile(part.getFileId(), null)) {
                            copyStream(is, zos);
                        }
                    }
                    zos.closeEntry();
                }
            }
        } catch (Exception e) {
            log.error("downloadZip error", e);
            // Can't send error after headers committed
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

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
