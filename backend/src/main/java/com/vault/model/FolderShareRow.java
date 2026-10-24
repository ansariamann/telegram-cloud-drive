package com.vault.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import lombok.Builder;

/**
 * Mirrors the FolderShareRow type from shares-db.server.ts
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class FolderShareRow {

    private String id;

    @JsonProperty("folder_id")
    private String folderId;

    private String token;
    private String label;

    @JsonProperty("allow_upload")
    private boolean allowUpload;

    @JsonProperty("allow_download")
    private boolean allowDownload;

    @JsonProperty("expires_at")
    private String expiresAt;

    @JsonProperty("is_active")
    private boolean isActive;

    @JsonProperty("created_at")
    private String createdAt;

    @JsonProperty("updated_at")
    private String updatedAt;
}
