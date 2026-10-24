package com.vault.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import lombok.Builder;

import java.util.List;

/**
 * Mirrors the FileRow type from files-db.server.ts
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class FileRow {

    private String id;
    private String filename;
    private String mime;

    @JsonProperty("size_bytes")
    private long sizeBytes;

    private String kind;
    private List<FilePart> parts;
    private List<String> tags;

    @JsonProperty("thumb_file_id")
    private String thumbFileId;

    @JsonProperty("folder_id")
    private String folderId;

    @JsonProperty("created_at")
    private String createdAt;

    @JsonProperty("updated_at")
    private String updatedAt;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class FilePart {
        private int index;

        @JsonProperty("file_id")
        private String fileId;

        @JsonProperty("message_id")
        private long messageId;

        private long size;
    }
}
