// @ts-expect-error Bun provides this module when the tests run.
import { describe, expect, test } from "bun:test";
import { kindFromMime, extractFileId, extractThumbId, type SendResult } from "./telegram.server";
import { DuplicateFileError } from "./upload";
import { MAX_AUTOMATIC_UPLOAD_RETRIES, splitBatchDuplicates, uploadIdentityKey } from "./upload-policy";

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

describe("upload duplicate error handler", () => {
  test("DuplicateFileError initializes correctly with message and name", () => {
    const err = new DuplicateFileError('File "test.pdf" already exists');
    expect(err.name).toBe("DuplicateFileError");
    expect(err.message).toBe('File "test.pdf" already exists');
    expect(err instanceof Error).toBe(true);
    expect(err instanceof DuplicateFileError).toBe(true);
  });
});

describe("upload policy", () => {
  test("allows only one automatic retry", () => {
    expect(MAX_AUTOMATIC_UPLOAD_RETRIES).toBe(1);
  });

  test("detects duplicate files in the same selected batch", () => {
    const first = { name: "report.pdf", size: 42 };
    const second = { name: "report.pdf", size: 42 };
    const other = { name: "report.pdf", size: 43 };
    const result = splitBatchDuplicates([first, second, other]);

    expect(result.unique).toEqual([first, other]);
    expect(result.duplicates).toEqual([second]);
    expect(uploadIdentityKey(first)).not.toBe(uploadIdentityKey(other));
  });
});
