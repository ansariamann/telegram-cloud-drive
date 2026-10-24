package com.vault.controller;

import com.vault.model.FolderRow;
import com.vault.service.FoldersDbService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * Folder endpoints — list, create, get, rename, delete, breadcrumbs.
 * Ports: api/folders.ts, api/folders.$id.ts
 */
@RestController
@RequestMapping("/api/folders")
public class FolderController {

    private final FoldersDbService foldersDb;
    private final AuthController auth;

    public FolderController(FoldersDbService foldersDb, AuthController auth) {
        this.foldersDb = foldersDb;
        this.auth = auth;
    }

    @GetMapping
    public ResponseEntity<?> listFolders(
            @RequestParam(name = "parent_id", required = false) String parentId,
            HttpServletRequest request) {

        if (!auth.isUnlocked(request)) return ResponseEntity.status(401).body(Map.of("error", "locked"));
        try {
            // "root", "null", blank all mean top-level (parent_id IS NULL)
            boolean parentIsNull = parentId == null || parentId.equals("null") || parentId.equals("root") || parentId.isBlank();
            String resolvedParent = parentIsNull ? null : parentId;
            List<FolderRow> folders = foldersDb.listFolders(resolvedParent, parentIsNull);
            // Wrap in {folders:[...]} to match what the React frontend expects
            return ResponseEntity.ok(Map.of("folders", folders));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping
    public ResponseEntity<?> createFolder(
            @RequestBody Map<String, Object> body,
            HttpServletRequest request) {

        if (!auth.isUnlocked(request)) return ResponseEntity.status(401).body(Map.of("error", "locked"));
        try {
            String name = (String) body.get("name");
            String parentId = (String) body.get("parent_id");
            if (name == null || name.isBlank()) return ResponseEntity.badRequest().body(Map.of("error", "name required"));
            FolderRow folder = foldersDb.createFolder(name, parentId);
            return ResponseEntity.ok(folder);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> getFolder(@PathVariable String id, HttpServletRequest request) {
        if (!auth.isUnlocked(request)) return ResponseEntity.status(401).body(Map.of("error", "locked"));
        try {
            FolderRow folder = foldersDb.getFolder(id);
            if (folder == null) return ResponseEntity.notFound().build();
            List<FolderRow> breadcrumbs = foldersDb.getFolderBreadcrumbs(id);
            return ResponseEntity.ok(Map.of("folder", folder, "breadcrumbs", breadcrumbs));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @PatchMapping("/{id}")
    public ResponseEntity<?> renameFolder(
            @PathVariable String id,
            @RequestBody Map<String, Object> body,
            HttpServletRequest request) {

        if (!auth.isUnlocked(request)) return ResponseEntity.status(401).body(Map.of("error", "locked"));
        try {
            String name = (String) body.get("name");
            if (name == null || name.isBlank()) return ResponseEntity.badRequest().body(Map.of("error", "name required"));
            FolderRow updated = foldersDb.renameFolder(id, name);
            return ResponseEntity.ok(updated);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteFolder(@PathVariable String id, HttpServletRequest request) {
        if (!auth.isUnlocked(request)) return ResponseEntity.status(401).body(Map.of("error", "locked"));
        try {
            foldersDb.deleteFolder(id);
            return ResponseEntity.ok(Map.of("ok", true));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }
}
