# Make uploads stop predictably

## Changes

- Allow exactly one attempts per file: the initial upload and one automatic retry. After that, leave the file failed with its existing manual retry control.
- Remove nested retry loops so a failure cannot multiply into many hidden attempts across the queue, file, chunk, finalize, and Telegram layers.
- Add finite request timeouts and cancellation-aware retry waits so a stalled Telegram request or browser upload cannot hold a queue worker indefinitely.
- Add an authenticated duplicate-check endpoint and call it before sending any bytes to Telegram. Keep the final database duplicate check as protection against simultaneous uploads.
- Detect duplicates both against saved files and within the same selected batch, using filename, byte size, and destination folder.
- Preserve completed-chunk recovery: a manual retry resumes cached chunks or retries finalization instead of starting the whole file again.

## Verification

- Add focused tests for retry limits, duplicate responses, cancellation, and recoverable finalization.
- Verify the preview builds cleanly and exercise duplicate rejection plus a forced upload failure in the browser.

## Technical details

- One layer will own automatic retry policy; lower layers will make a single bounded attempt and return clear errors.
- Telegram rate-limit responses may honor one bounded server-directed wait, but will not recursively retry multiple times.
- Duplicate rejection remains based on the current rule: same filename and exact byte size in the same folder.