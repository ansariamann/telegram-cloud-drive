# Telegram File Vault

A single-user web app that treats your private Telegram group as unlimited cloud storage. You drop files in; the app forwards them to the group, records metadata in a database, and gives you a searchable, previewable file manager on top.

## Important note on the 2GB limit

You picked "up to 2GB per file". The public Telegram Bot API only accepts uploads up to **50MB per file** (and downloads up to 20MB). Going to 2GB requires either:

- **(A)** Running your own self-hosted Telegram Bot API server (a separate Docker service you host somewhere — Lovable can't host it), or
- **(B)** Using MTProto client libraries (GramJS/Telethon) with a user account instead of a bot — more complex, needs phone-number login + session string, and can't run inside this app's edge runtime.

Neither fits cleanly into a Lovable app. I'll build for the **50MB Bot API limit** and, for files above 50MB, the app will automatically **chunk them into 45MB parts**, upload each part as a separate Telegram document, and stitch them back together on download. That gets you effectively unlimited size using only the standard bot. If you'd rather do (A) or (B), tell me and I'll revise.

## What you'll set up (one time)

1. Create a bot with @BotFather → get bot token.
2. Create a private Telegram group, add the bot as admin.
3. Get the chat ID (I'll include a `/whoami` helper: send any message to the group, tap a button in the app, it reads `getUpdates` and shows the chat ID).
4. Paste `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and an `APP_PASSCODE` into Lovable Cloud secrets.

## UX

**Single passcode gate** (since it's just you): unlock with `APP_PASSCODE` stored in an httpOnly session cookie. No signup UI.

**Main screen — File Manager**
- Top bar: search box (filename + tags), view toggle (grid/list), sort (date, size, name, type), type filter chips (Image, Video, Audio, PDF, Archive, Other).
- Big drag-and-drop zone across the whole page; also a "＋ Upload" button. Multi-file supported.
- Grid view: thumbnail cards (image thumbs from Telegram's own thumbnail, video poster frame, PDF first-page render, generic icon for zip/mp3/other) with filename, size, date.
- Row/hover actions: Preview, Download, Copy link, Rename, Add tag, Delete.
- Upload tray (bottom-right): per-file progress bar, chunk counter ("Part 3/12"), pause/resume, retry on failure.

**Preview modal**
- Images: full-size viewer with zoom.
- Video (mp4): inline `<video>` player streamed from a signed app URL that proxies Telegram's file.
- Audio (mp3): inline `<audio>` player.
- PDF: embedded `<iframe>` viewer.
- Zip/other: metadata + download button.

**Details drawer**: filename, size, MIME, upload date, tags, Telegram message ID(s), part count, direct message link (`https://t.me/c/...`).

**Empty + loading states**, toast notifications for upload success/failure.

## Visual direction

Dark, dense, utility-first — think Linear / Raycast / a modern file browser. Neutral slate background, single blue accent for primary actions, monospaced numerals for size/date columns, subtle grid lines. No purple gradients, no glassmorphism.

## How uploads work (technical)

1. Client picks file → POST multipart to `/api/upload` (TanStack server route).
2. Server passcode-checks the session cookie.
3. If file ≤ 45MB: single `sendDocument` (or `sendPhoto`/`sendVideo`/`sendAudio` based on MIME so Telegram generates thumbnails/previews).
4. If file > 45MB: split into 45MB parts, send each as `sendDocument` with caption `filename.ext.partNN`, collect all `file_id`s and `message_id`s.
5. Insert row in `files` table with metadata + JSON array of parts.
6. Return the new row; client updates the grid optimistically.

**Downloads / previews**: `/api/file/:id` and `/api/file/:id/stream` server routes:
- Call `getFile` per part → fetch bytes from `api.telegram.org/file/bot<TOKEN>/<path>` → stream to the client. For multi-part, concatenate parts in order (supports HTTP Range for seekable video/audio).
- URLs are signed with a short-lived HMAC token so the file endpoints don't need the session cookie (enables `<video src>` playback).

## Data model (Lovable Cloud / Postgres)

```
files
  id            uuid pk
  filename      text
  mime          text
  size_bytes    bigint
  kind          text       -- image | video | audio | pdf | archive | other
  parts         jsonb      -- [{ file_id, message_id, size, index }]
  tags          text[]
  thumb_file_id text        -- Telegram file_id of thumbnail, nullable
  created_at    timestamptz default now()
```

Full-text index on `filename` + `tags`. Single-user, so RLS is simple: all rows readable/writable via a service-role server route behind the passcode check. No `auth.users`, no per-user scoping.

## Tech breakdown

- **Frontend**: TanStack Start routes — `/` (locked → passcode form or file manager), `/settings` (chat ID helper, secrets status).
- **Server routes**: `/api/unlock`, `/api/upload`, `/api/files` (list/search), `/api/file/:id` (metadata), `/api/file/:id/stream` (bytes), `/api/file/:id` DELETE (also calls `deleteMessage` on Telegram), `/api/whoami` (calls `getUpdates`, returns detected chat IDs).
- **Secrets**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `APP_PASSCODE`, `FILE_URL_SIGNING_SECRET` (auto-generated).
- **Backend**: Lovable Cloud (Postgres + edge runtime). No Telegram connector — using raw Bot API with your token as you chose.
- **Libs**: `zod` for validation, `lucide-react` icons, shadcn `dialog`/`sheet`/`command`/`progress`/`table`/`toast`.

## Build order

1. Enable Lovable Cloud, add secrets, create `files` table + migration.
2. Passcode gate + session cookie.
3. Telegram helper module (send, getFile, deleteMessage, chunking, streaming with Range).
4. Upload route + upload tray UI.
5. File list, search, filters, sort.
6. Preview modal (image/video/audio/pdf) + streaming route with signed URLs.
7. Rename, tags, delete.
8. Settings page with `/whoami` chat-ID detector.
9. Polish: empty states, error toasts, keyboard shortcuts (⌘K search, Space preview, Del delete).

## Out of scope for v1

- Multi-user accounts, sharing links to strangers, folders/nested paths (flat + tags instead), true 2GB single-file uploads without chunking, mobile share-sheet integration.

Confirm and I'll build it. If you'd rather cap files at 50MB (no chunking) or pursue the self-hosted Bot API path for true 2GB, say so before I start.