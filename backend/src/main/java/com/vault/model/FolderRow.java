package com.vault.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import lombok.Builder;

/**
 * Mirrors the FolderRow type from folders-db.server.ts
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class FolderRow {

    private String id;
    private String name;

    @JsonProperty("parent_id")
    private String parentId;

    @JsonProperty("created_at")
    private String createdAt;

    @JsonProperty("updated_at")
    private String updatedAt;
}
