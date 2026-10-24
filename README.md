# 🔐 Vault — Telegram Cloud Drive

> **A modern, private, self-hosted cloud drive backed by Telegram and Supabase** — store, organize, preview, and stream unlimited files through an elegant web interface, using your private Telegram channel/group as free, zero-cost cloud object storage.

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [Features & Capabilities](#-features--capabilities)
- [Prerequisites](#-prerequisites)
- [Environment Configuration](#-environment-configuration)
- [Database Schema (Supabase SQL)](#-database-schema-supabase-sql)
- [Step-by-Step Setup Guide](#-step-by-step-setup-guide)
  - [1. Clone Repository](#1-clone-repository)
  - [2. Configure Telegram Bot & Chat](#2-configure-telegram-bot--chat)
  - [3. Configure Supabase](#3-configure-supabase)
  - [4. Set Up Environment Variables](#4-set-up-environment-variables)
  - [5. Run Java Spring Boot Backend](#5-run-java-spring-boot-backend)
  - [6. Run React Frontend](#6-run-react-frontend)
- [Production Deployment](#-production-deployment)
- [Complete REST API Reference](#-complete-rest-api-reference)
  - [Authentication & Status](#1-authentication--status)
  - [Files API](#2-files-api)
  - [Folders API](#3-folders-api)
  - [Uploads API](#4-uploads-api)
  - [Share Links API](#5-share-links-api)
- [Security Model](#-security-model)
- [Project Structure](#-project-structure)
- [Troubleshooting](#-troubleshooting)
- [License](#-license)

---

## 🌟 Overview

**Vault** bridges the Telegram Bot API with a modern web file manager:
- **Zero Cloud Storage Bills**: Files are uploaded to and retained in your private Telegram group or supergroup.
- **No File Size Caps**: Telegram has a 50 MB per-file bot limit. Vault solves this by automatically splitting large files into ≤45 MB chunks on upload and seamlessly stitching them back together on download and streaming.
- **Fast Metadata & Indexing**: Powered by Supabase PostgreSQL for millisecond search, folder hierarchies, and sharing permissions.
- **Enterprise-Grade Java Backend**: Spring Boot 3 + Java 17 for robust multi-threaded streaming, rate limiting, and security.
- **Clean React UI**: Fast, responsive single-page application built with React, Vite, and Lucide icons.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│                   React + Vite UI                      │
│        (File Explorer, Previews, Drag & Drop)          │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP / JSON & Streams (port 5173 -> 8080)
┌──────────────────────────▼─────────────────────────────┐
│             Java Spring Boot 3 Backend                 │
│                                                        │
│  • Auth & Session Guard (HMAC-SHA256, timing-safe)     │
│  • In-Memory Bucket Token Rate Limiting (Leaky Bucket) │
│  • Chunked Upload Coordinator (≤45 MB part validation) │
│  • High-throughput Range / Chunk Byte Streaming Pipe   │
│  • ZIP Packaging Engine (Path Traversal Protected)     │
└──────────────┬───────────────────────────┬─────────────┘
               │                           │
      Supabase REST API             Telegram Bot API
               │                           │
┌──────────────▼────────────┐  ┌───────────▼─────────────┐
│   Supabase (PostgreSQL)   │  │   Telegram Supergroup   │
│  • files table            │  │  • Stored binary chunks │
│  • folders table          │  │  • Document file IDs    │
│  • folder_shares table    │  │  • Thumbnails           │
└───────────────────────────┘  └─────────────────────────┘
```

---

## ✨ Features & Capabilities

- 🔒 **Passcode Protection**: Protect the entire vault with a secure passcode. Sessions use HMAC-SHA256 signed HTTP-only cookies with constant-time equality comparisons.
- 📁 **Hierarchical Folders**: Unlimited nested directories with instant breadcrumb traversal and folder creation/renaming/deletion.
- 🧩 **Smart Multi-part Uploads**: Automatically splits files larger than 45 MB into sequential chunks, uploads each to Telegram, and records part identifiers in PostgreSQL.
- 📺 **On-the-Fly Media Streaming**: Supports HTTP `Range` requests for video and audio playback directly from Telegram's CDN without downloading the entire file first.
- 🖼️ **Inline Previews**: Live viewer for images, videos, audio, and PDFs with thumbnail previews.
- 🔍 **Full-Text File Search**: Instant client and server filtering by file name and folder scope.
- 🏷️ **Type Filters & Sorting**: Filter by Photos, Videos, Audio, Documents, Archives, or Code; sort by Name, Size, or Date.
- 🔗 **Folder Sharing**: Generate shareable public links with optional write permissions (allowing third parties to upload into your shared folder or download folders as ZIP).
- 📦 **Bulk ZIP Downloads**: Download any folder or file selection as a compressed ZIP file on demand.
- 🛡️ **Hardened Security**: Includes rate limiting on upload checks, signed session validation, upload file size limits, MIME type enforcement, and zip slip traversal mitigation.

---

## 📦 Prerequisites

Before starting, ensure your system has:

1. **Java Development Kit (JDK)**: Java 17 or higher (`java -version`).
2. **Node.js**: Node.js 18.x or higher and `npm` (`node -v`).
3. **Telegram Account**: A bot created via [@BotFather](https://t.me/BotFather) and a private channel or group.
4. **Supabase Account**: A free project created at [supabase.com](https://supabase.com).

---

## ⚙️ Environment Configuration

Create a `.env` file in the project root directory (or configure system environment variables):

```env
# ========================================================
# Supabase Configuration
# ========================================================
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJh...your-service-role-key...

# ========================================================
# Telegram Bot Configuration
# ========================================================
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ
TELEGRAM_CHAT_ID=-1001234567890

# ========================================================
# Vault Security & Session
# ========================================================
VAULT_PASSCODE=your_vault_passcode_here
SESSION_SECRET=a_long_random_string_at_least_32_characters_for_hmac

# ========================================================
# Server Configuration (Optional defaults)
# ========================================================
SERVER_PORT=8080
ALLOWED_ORIGIN=http://localhost:5173
```

### Environment Variables Detail

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | **Yes** | Your Supabase Project URL (`https://xyz.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | The `service_role` secret key from Supabase (bypasses RLS for backend CRUD) |
| `TELEGRAM_BOT_TOKEN` | **Yes** | HTTP Bot Token obtained from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | **Yes** | Negative integer ID of the target group/supergroup (e.g. `-100...`) |
| `VAULT_PASSCODE` | **Yes** | Passcode users enter on the web page to unlock the vault |
| `SESSION_SECRET` | **Yes** | 32+ character random secret used for HMAC-SHA256 session token signatures |
| `SERVER_PORT` | No | Java Spring Boot server port (default: `8080`) |
| `ALLOWED_ORIGIN` | No | CORS allowed origin for frontend dev server (default: `http://localhost:5173`) |

---

## 🗄️ Database Schema (Supabase SQL)

In your **Supabase Dashboard** -> **SQL Editor**, run the following migration:

```sql
-- Create folders table
CREATE TABLE IF NOT EXISTS public.folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    parent_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create files table
CREATE TABLE IF NOT EXISTS public.files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    size BIGINT NOT NULL DEFAULT 0,
    mime_type TEXT,
    telegram_file_id TEXT,
    parts JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create folder_shares table
CREATE TABLE IF NOT EXISTS public.folder_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id UUID NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    allow_upload BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

-- Create helpful indexes
CREATE INDEX IF NOT EXISTS idx_files_folder_id ON public.files(folder_id);
CREATE INDEX IF NOT EXISTS idx_files_name ON public.files(name);
CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON public.folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_shares_token ON public.folder_shares(token);
CREATE INDEX IF NOT EXISTS idx_shares_folder_id ON public.folder_shares(folder_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folder_shares ENABLE ROW LEVEL SECURITY;

-- Note: The Spring Boot backend connects using the SUPABASE_SERVICE_ROLE_KEY,
-- which automatically bypasses RLS while keeping direct public anonymous access denied.
```

---

## 🚀 Step-by-Step Setup Guide

### 1. Clone Repository

```bash
git clone https://github.com/ansariamann/telegram-cloud-drive.git
cd telegram-cloud-drive
```

### 2. Configure Telegram Bot & Chat

1. Open Telegram and message [@BotFather](https://t.me/BotFather).
2. Send `/newbot`, name your bot, and copy the **API Token** (`TELEGRAM_BOT_TOKEN`).
3. Create a **New Group** or **Channel** in Telegram (e.g. "My Vault Storage").
4. Add your bot into the group/channel and promote it to **Administrator** (with "Post Messages" and "Delete Messages" permissions).
5. Obtain the group's `TELEGRAM_CHAT_ID`:
   - Send any test message in your group.
   - Open: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates` in your browser.
   - Look for `"chat":{"id":-100xxxxxxxxx}`.
   - Copy this number (including the minus sign) to `TELEGRAM_CHAT_ID`.

### 3. Configure Supabase

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Under **Project Settings** -> **API**, copy:
   - **Project URL** -> `SUPABASE_URL`
   - **service_role key** (Secret) -> `SUPABASE_SERVICE_ROLE_KEY`
3. Under **SQL Editor**, paste and run the SQL migration provided above.

### 4. Set Up Environment Variables

Create `.env` in the root of the project with your secrets:

```env
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJh...
TELEGRAM_BOT_TOKEN=123456789:AA...
TELEGRAM_CHAT_ID=-1001234567890
VAULT_PASSCODE=mypassword123
SESSION_SECRET=e7b415e98f62c0b5f1345dc6189ea7303e48e894c25f6904bf35041a
```

### 5. Run Java Spring Boot Backend

The backend automatically loads your `.env` file upon startup.

```bash
cd backend

# On Windows:
.\mvnw.cmd spring-boot:run

# On Linux / macOS:
./mvnw spring-boot:run
```

The server starts at `http://localhost:8080`.
Verify backend status by browsing to: `http://localhost:8080/api/status` (should return `{"status":"ok"}`).

### 6. Run React Frontend

In another terminal window:

```bash
cd frontend

# Install dependencies (first time only)
npm install

# Start development server
npm run dev
```

Open `http://localhost:5173` in your browser. Enter your `VAULT_PASSCODE` to unlock your drive!

---

## 🚢 Production Deployment

### 1. Build Backend JAR
```bash
cd backend
./mvnw clean package -DskipTests
```
This produces `backend/target/vault-backend-1.0.0.jar`.

Run the production JAR:
```bash
java -jar backend/target/vault-backend-1.0.0.jar
```

### 2. Build Frontend Static Assets
```bash
cd frontend
npm run build
```
This outputs compiled, optimized assets to `frontend/dist/`.

### 3. Production Deployment Topologies
- **Option A (Reverse Proxy / Nginx / Caddy)**: Serve `frontend/dist` statically on port 80/443 and proxy `/api/*` to `http://127.0.0.1:8080`.
- **Option B (Embedded)**: Copy the contents of `frontend/dist/*` into `backend/src/main/resources/static/` and package into a single executable jar.

---

## 📡 Complete REST API Reference

All protected API endpoints require an active session cookie (`vault_session`) or a valid folder share token where indicated.

### 1. Authentication & Status

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/status` | Check API health | No |
| `POST` | `/api/unlock` | Validate passcode & obtain `vault_session` cookie | No |
| `POST` | `/api/lock` | Invalidate session and clear auth cookie | Yes |
| `GET` | `/api/whoami` | Verify current session validity | No |

#### `POST /api/unlock`
**Request Body:**
```json
{
  "passcode": "your_vault_passcode"
}
```
**Response (200 OK):**
```json
{
  "unlocked": true
}
```
*Sets `Set-Cookie: vault_session=<hmac-signed-token>; Path=/; HttpOnly; SameSite=Lax`*

---

### 2. Files API

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/files?folderId={id}` | List files (filter by optional `folderId`) | Yes |
| `GET` | `/api/files/{id}` | Get metadata for a specific file | Yes |
| `GET` | `/api/files/{id}/stream` | Stream file binary (supports HTTP Range headers) | Yes |
| `GET` | `/api/files/{id}/thumb` | Get image/video thumbnail binary | Yes |
| `GET` | `/api/files/{id}/link` | Get direct streaming link | Yes |
| `PATCH` | `/api/files/{id}` | Rename file or move to another folder | Yes |
| `DELETE` | `/api/files/{id}` | Delete file metadata & delete messages from Telegram | Yes |
| `POST` | `/api/files/download-zip` | Download multiple selected files as a ZIP archive | Yes |

#### `PATCH /api/files/{id}`
**Request Body:**
```json
{
  "name": "new_filename.pdf",
  "folder_id": "uuid-or-null"
}
```

#### `POST /api/files/download-zip`
**Request Body:**
```json
{
  "fileIds": ["uuid-1", "uuid-2"]
}
```

---

### 3. Folders API

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/folders` | List all folders | Yes |
| `POST` | `/api/folders` | Create a new folder | Yes |
| `GET` | `/api/folders/{id}` | Get folder metadata | Yes |
| `PATCH` | `/api/folders/{id}` | Rename folder | Yes |
| `DELETE` | `/api/folders/{id}` | Recursively delete folder and its files | Yes |

#### `POST /api/folders`
**Request Body:**
```json
{
  "name": "Documents",
  "parent_id": null
}
```

---

### 4. Uploads API

Files larger than 45 MB are split by the client into ≤45 MB parts.

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/upload-check` | Check upload eligibility & rate limit | Yes |
| `POST` | `/api/upload-chunk` | Upload a single part (multipart/form-data) | Yes |
| `POST` | `/api/upload-finalize` | Finalize upload & commit file row to database | Yes |

#### `POST /api/upload-chunk`
- `multipart/form-data`:
  - `file`: Blob / binary chunk
  - `partIndex`: integer (0-based)
  - `totalParts`: integer

#### `POST /api/upload-finalize`
**Request Body:**
```json
{
  "name": "backup.tar.gz",
  "size": 120586240,
  "mimeType": "application/gzip",
  "folderId": "uuid-or-null",
  "parts": [
    { "partIndex": 0, "fileId": "BAADBAAD...", "size": 47185920 },
    { "partIndex": 1, "fileId": "BAADBAAD...", "size": 47185920 },
    { "partIndex": 2, "fileId": "BAADBAAD...", "size": 26214400 }
  ]
}
```

---

### 5. Share Links API

Allows sharing specific folders with public links, with optional upload permissions.

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/folders/{id}/share` | Get existing share tokens for a folder | Yes |
| `POST` | `/api/folders/{id}/share` | Create a new share token (`allow_upload: true/false`) | Yes |
| `GET` | `/api/shares/{token}` | Public: access shared folder metadata & contents | Public (Token) |
| `GET` | `/api/shares/{token}/files/{fileId}/stream` | Public: stream file within shared folder | Public (Token) |
| `GET` | `/api/shares/{token}/files/{fileId}/thumb` | Public: get thumbnail within shared folder | Public (Token) |
| `POST` | `/api/shares/{token}/download-zip` | Public: download shared folder contents as ZIP | Public (Token) |
| `POST` | `/api/shares/{token}/upload-check` | Public (if upload allowed): check upload | Public (Token) |
| `POST` | `/api/shares/{token}/upload-chunk` | Public (if upload allowed): upload chunk | Public (Token) |
| `POST` | `/api/shares/{token}/upload-finalize` | Public (if upload allowed): finalize upload | Public (Token) |
| `POST` | `/api/shares/{token}/create-folder` | Public (if upload allowed): create subfolder | Public (Token) |

---

## 🔒 Security Model

1. **HMAC-SHA256 Signed Sessions**:
   Cookies are signed with `SESSION_SECRET` using HMAC-SHA256 (`timestamp.signature`). Verification uses `MessageDigest.isEqual()` constant-time checking to eliminate timing attack vectors.
2. **In-Memory Rate Limiting**:
   Sensitive endpoints (such as `upload-check`) implement token bucket rate limiting (20 requests / 10-second window per client IP) to block automated abuse.
3. **Upload Security**:
   - Single-chunk size enforcement (maximum 50 MB per Telegram Bot API limitation).
   - Thumbnail upload MIME validation ensuring only safe image types (`image/jpeg`, `image/png`, `image/webp`) are accepted.
4. **ZIP Slip Protection**:
   Archive generation sanitizes entry names (`Path.normalize()`) and strips path traversal sequences (`../`, `..\`) to prevent directory traversal exploits.
5. **Zero Secret Leakage**:
   `TELEGRAM_BOT_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, and `SESSION_SECRET` remain exclusively on the server side and are never delivered to the client browser.

---

## 📁 Project Structure

```
telegram-cloud-drive/
├── .env                              # Environment variables (gitignored)
├── README.md                         # This comprehensive guide
├── pom.xml / mvnw                    # Root Maven wrapper
│
├── backend/                          # Java Spring Boot 3 Application
│   ├── pom.xml                       # Maven configuration & dependencies
│   ├── mvnw / mvnw.cmd               # Maven wrapper scripts
│   └── src/main/java/com/vault/
│       ├── VaultApplication.java     # Spring Boot application entry point
│       ├── config/
│       │   ├── CorsConfig.java       # Cross-Origin Resource Sharing config
│       │   └── DotenvConfig.java     # .env loader before Spring context
│       ├── controller/
│       │   ├── AuthController.java   # /api/status, unlock, lock, whoami
│       │   ├── FileController.java   # /api/files CRUD, streaming, thumbnails, zip
│       │   ├── FolderController.java # /api/folders CRUD
│       │   └── ShareController.java  # /api/shares & upload endpoints
│       ├── model/
│       │   ├── FileRow.java          # File metadata model
│       │   ├── FolderRow.java        # Folder model
│       │   └── FolderShareRow.java   # Share link model
│       └── service/
│           ├── FilesDbService.java   # Supabase REST CRUD for files
│           ├── FoldersDbService.java # Supabase REST CRUD for folders
│           ├── SharesDbService.java  # Supabase REST CRUD for shares
│           ├── GateService.java      # Cookie signing & timing-safe validation
│           └── TelegramService.java  # Telegram Bot API upload/download client
│
└── frontend/                         # Modern React + Vite Single Page Application
    ├── index.html                    # HTML entry point with SVG favicon
    ├── package.json                  # Frontend dependencies & scripts
    ├── vite.config.js                # Vite build config with /api proxy to 8080
    ├── public/
    │   ├── favicon.svg               # Vector SVG vault lock favicon
    │   └── favicon.ico               # Legacy ICO favicon fallback
    └── src/
        ├── App.jsx                   # Main routing & unlock gate logic
        ├── main.jsx                  # React DOM mount point
        ├── index.css                 # Dark theme design system & animations
        └── components/
            ├── FileManager.jsx       # Grid/list browser, search, filters, actions
            ├── FilePreview.jsx       # Inline audio/video/image/PDF preview modal
            ├── FolderPicker.jsx      # Folder selection modal for moving items
            ├── NewFolderDialog.jsx   # Create folder dialog
            ├── ShareFolderDialog.jsx # Create & manage public share links
            ├── SharedFolderView.jsx  # Public recipient view for shared folders
            └── ConfirmDialog.jsx     # Destructive confirmation modal
```

---

## ❓ Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| **`TELEGRAM_BOT_TOKEN not set`** | Missing or misnamed key in `.env` | Verify `.env` is in the project root or configure system environment variables. |
| **`400 Bad Request: chat not found`** | Wrong `TELEGRAM_CHAT_ID` or Bot not in group | Add the bot as Administrator in your group and ensure the Chat ID starts with `-100`. |
| **Upload chunk fails at 50 MB** | Chunk size exceeds Telegram Bot API limit | Ensure client chunks are split to 45 MB or less (default client uses 45 MB). |
| **Session expires immediately** | Secret modified or invalid clock | Ensure `SESSION_SECRET` is static. Make sure your server and computer clocks are synchronized. |
| **CORS errors in browser** | Mismatched frontend origin | Ensure `ALLOWED_ORIGIN` in `.env` matches your frontend host (`http://localhost:5173`). |
| **Supabase 401 Unauthorized** | Wrong key used | Ensure you are using `SUPABASE_SERVICE_ROLE_KEY` (service role), **not** the `anon` public key. |

---

## 📄 License

This project is open-source under the [MIT License](LICENSE).
Feel free to fork, customize, and self-host!
