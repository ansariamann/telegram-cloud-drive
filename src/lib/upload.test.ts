import { describe, expect, test } from "bun:test";
import { kindFromMime, extractFileId, extractThumbId, type SendResult } from "./telegram.server";

describe("telegram helpers", () => {
  test("kindFromMime categorizes mime types correctly", () => {
    expect(kindFromMime("image/png")).toBe("image");
    expect(kindFromMime("video/mp4")).toBe("video");
    expect(kindFromMime("audio/mpeg")).toBe("audio");
    expect(kindFromMime("application/pdf")).toBe("pdf");
    expect(kindFromMime("application/zip")).toBe("archive");
    expect(kindFromMime("text/plain")).toBe("other");
  });

  test("extractFileId extracts file_id properly", () => {
    const docResult: SendResult = {
      message_id: 1,
      document: {
        file_id: "doc_123",
        file_unique_id: "uniq_123",
      },
    };
    expect(extractFileId(docResult)).toBe("doc_123");

    const photoResult: SendResult = {
      message_id: 2,
      photo: [
        { file_id: "photo_small", width: 100, height: 100 },
        { file_id: "photo_large", width: 800, height: 800 },
      ],
    };
    expect(extractFileId(photoResult)).toBe("photo_large");
    expect(extractThumbId(photoResult)).toBe("photo_small");
  });
});
