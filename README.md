# ?? Telegram Cloud Drive (Vault)

> **A private, self-hosted cloud drive backed by Telegram** — store, organize, and stream unlimited files through a beautiful web interface, using Telegram as free cloud storage.

---

## ? What is this?

**Vault** is a full-stack web application that turns a private Telegram group into your personal, unlimited cloud storage. You upload files through a sleek file manager UI; the app chunked-uploads them to Telegram via the Bot API and records metadata in Supabase. Files can be downloaded or streamed on-demand directly from Telegram's CDN — no cloud storage bills, no size caps (files > 45 MB are auto-split).

---

## ?? Features

| Feature | Details |
|---|---|
| ?? **Passcode lock** | HMAC-signed session cookie — lock/unlock the entire vault with a passcode |
| ?? **Folder system** | Nested folders with breadcrumb navigation |
| ?? **Chunked uploads** | Files > 45 MB are auto-split into =45 MB parts and reassembled on download |
| ??? **Drag & drop** | Drop files anywhere on the page to upload |
| ?? **Full-text search** | Search filenames across all folders instantly |
| ?? **Rich file previews** | Inline viewer for images, videos, audio, and PDFs |
| ?? **Grid & list views** | Toggle between a thumbnail grid and a dense table view |
| ??? **File filters** | Filter by type: Images, Video, Audio, PDF, Archives, Other |
| ?? **Sort options** | Sort by date, name, or size (asc/desc) |
| ?? **Rename files/folders** | Inline rename via the file preview or folder card |
| ?? **Move files** | Move files between folders with a folder picker |
| ??? **Delete** | Delete files (removes from Telegram too) and folders |
| ??? **Thumbnails** | Thumbnails for images and videos via Telegram |
| ?? **Responsive** | Works on desktop and mobile |

---

## ??? Architecture

```
Browser (React + TanStack Router)
        ¦
        ?
 TanStack Start SSR Server (Nitro)
        ¦
        +--- Supabase (PostgreSQL)      ? file/folder metadata
        ¦
        +--- Telegram Bot API           ? actual file storage
```

### Key flows

**Upload:**
1. Client slices the file into =45 MB chunks
2. Each chunk is `POST /api/upload-chunk` ? server forwards to Telegram Bot API
3. Telegram returns a `file_id` and `message_id` per part
4. Client calls `POST /api/upload-finalize` ? server writes a row to Supabase with the array of parts

**Download/Stream:**
1. Client hits `GET /api/files/:id/stream`
2. Server fetches each part from Telegram's CDN, reassembles the byte stream, and proxies it

---

## ?? Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js** = 18 | Or use Bun |
| **Supabase project** | Free tier works; you need a PostgreSQL database |
| **Telegram Bot** | Create via @BotFather |
| **Private Telegram Group** | Add your bot as admin |

---

## ?? Setup

### 1. Clone the repository

```bash
git clone https://github.com/your-username/telegramstore.git
cd telegramstore
```

### 2. Install dependencies

```bash
npm install
# or
bun install
```

### 3. Create a Telegram Bot & Group

1. Open Telegram ? search for **@BotFather** ? `/newbot`
2. Copy the **Bot Token** (looks like `123456:ABC-DEF...`)
3. Create a **private group** and add your bot as an **admin** with permission to send messages
4. Send any message in the group
5. Visit the app **Settings** page ? **"Check bot updates"** to find your **Chat ID** (a negative number like `-1001234567890`)

### 4. Set up Supabase

1. Create a project at supabase.com
2. Go to **SQL Editor** and run the migration files in order from `supabase/migrations/`
3. Copy your **Project URL** and **Service Role Key** from **Project Settings ? API**

### 5. Configure environment variables

Create a `.env` file in the project root:

```env
# Telegram
TELEGRAM_BOT_TOKEN=123456:YOUR-BOT-TOKEN
TELEGRAM_CHAT_ID=-1001234567890

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# App Security
APP_PASSCODE=your-secret-passcode
SESSION_SECRET=a-long-random-string-at-least-32-chars
```

> ?? **Never commit your `.env` file.** It is already in `.gitignore`.

### 6. Run the development server

```bash
npm run dev
```

Open http://localhost:3000 and enter your passcode.

---

## ?? Production Deployment

```bash
npm run build
```

Output is in `.output/` (Nitro-based server bundle). Deploy to:

| Platform | Notes |
|---|---|
| **Cloudflare Workers** | Nitro targets Cloudflare — zero cold starts |
| **Railway / Render** | Node.js server mode |
| **Vercel** | Works via the Nitro Vercel preset |
| **VPS / Docker** | Run `.output/server/index.mjs` |

---

## ??? Database Schema

### `files`

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Auto-generated |
| `filename` | text | Original file name |
| `mime` | text | MIME type |
| `size_bytes` | bigint | Total file size |
| `kind` | text | `image`, `video`, `audio`, `pdf`, `archive`, `other` |
| `parts` | jsonb | Array of `{index, file_id, message_id, size}` |
| `tags` | text[] | User-defined tags |
| `thumb_file_id` | text | Telegram thumbnail file_id |
| `folder_id` | uuid FK | Parent folder (null = root) |
| `created_at` | timestamptz | Upload time |
| `updated_at` | timestamptz | Last modified |

### `folders`

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Auto-generated |
| `name` | text | Folder name |
| `parent_id` | uuid FK | Parent folder (null = root) |
| `created_at` | timestamptz | Creation time |
| `updated_at` | timestamptz | Last modified |

---

## ?? API Reference

All endpoints require a valid session (cookie or `Authorization: Bearer <token>`).

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/unlock` | Verify passcode, issue session |
| `POST` | `/api/lock` | Invalidate session |
| `GET` | `/api/status` | Check vault lock status |
| `GET` | `/api/whoami` | List Telegram bot updates (chat ID detection) |
| `GET` | `/api/files` | List files (`?q=`, `?kind=`, `?sort=`, `?folder_id=`) |
| `GET` | `/api/files/:id` | Get file metadata |
| `PATCH` | `/api/files/:id` | Rename (`filename`) or move (`folder_id`) |
| `DELETE` | `/api/files/:id` | Delete file + Telegram messages |
| `GET` | `/api/files/:id/stream` | Stream/download (`?dl=1` forces download) |
| `GET` | `/api/files/:id/thumb` | Proxy thumbnail |
| `POST` | `/api/upload-chunk` | Upload one chunk to Telegram |
| `POST` | `/api/upload-finalize` | Finalize upload, write to DB |
| `GET` | `/api/folders` | List folders (`?parent_id=root` or `?parent_id=<uuid>`) |
| `POST` | `/api/folders` | Create folder |
| `GET` | `/api/folders/:id` | Get folder + breadcrumb trail |
| `PATCH` | `/api/folders/:id` | Rename folder |
| `DELETE` | `/api/folders/:id` | Delete folder |

---

## ?? Security Notes

- Passcode verification uses **timing-safe comparison** to prevent timing attacks
- Sessions are **HMAC-SHA256 signed** and expire after 30 days
- `SUPABASE_SERVICE_ROLE_KEY` and `TELEGRAM_BOT_TOKEN` are **never exposed to the browser**
- All API routes enforce `requireUnlocked()` before any data access

---

## ??? Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | TanStack Start (React + SSR via Nitro) |
| **Router** | TanStack Router (file-based) |
| **Data fetching** | TanStack Query |
| **Database** | Supabase (PostgreSQL) |
| **Storage backend** | Telegram Bot API |
| **UI components** | shadcn/ui + Radix UI |
| **Styling** | Tailwind CSS v4 |
| **Icons** | Lucide React |
| **Toasts** | Sonner |
| **Language** | TypeScript |
| **Build tool** | Vite |
| **Runtime** | Node.js / Cloudflare Workers (Nitro) |

---

## ?? Project Structure

```
telegramstore/
+-- src/
¦   +-- routes/
¦   ¦   +-- __root.tsx           # Root layout, unlock guard
¦   ¦   +-- index.tsx            # Main file manager page
¦   ¦   +-- settings.tsx         # Settings: chat ID detection, lock vault
¦   ¦   +-- unlock.tsx           # Passcode entry screen
¦   ¦   +-- api/                 # Server API endpoints
¦   ¦       +-- files.ts / files.$id.ts / files.$id.stream.ts / ...
¦   ¦       +-- folders.ts / folders.$id.ts
¦   ¦       +-- upload-chunk.ts / upload-finalize.ts
¦   ¦       +-- unlock.ts / lock.ts / status.ts / whoami.ts
¦   +-- components/
¦   ¦   +-- file-manager.tsx     # Main file browser (grid/list, search, filters)
¦   ¦   +-- file-preview.tsx     # Full-screen file viewer + metadata sidebar
¦   ¦   +-- folder-picker.tsx    # Modal for moving files
¦   ¦   +-- new-folder-dialog.tsx
¦   ¦   +-- ui/                  # shadcn/ui base components
¦   +-- lib/
¦   ¦   +-- telegram.server.ts   # Telegram Bot API wrapper
¦   ¦   +-- files-db.server.ts   # Supabase file CRUD
¦   ¦   +-- folders-db.server.ts # Supabase folder CRUD
¦   ¦   +-- gate.server.ts       # Session auth (HMAC, cookies)
¦   ¦   +-- upload.ts            # Client-side chunked upload
¦   ¦   +-- vault-client.ts      # Authenticated fetch wrapper
¦   ¦   +-- format.ts            # formatBytes, formatDate helpers
¦   ¦   +-- signed-url.server.ts # Signed URL generation
¦   +-- integrations/supabase/   # Supabase client setup
¦   +-- styles.css
¦   +-- server.ts                # Nitro entry point
+-- supabase/migrations/         # SQL migration files
+-- public/
+-- .env                         # Environment variables (gitignored)
+-- package.json
```

---

## ????? Development Commands

```bash
npm run dev        # Start dev server with HMR
npm run build      # Build for production
npm run preview    # Preview production build locally
npm run lint       # ESLint
npm run format     # Prettier
```

---

## ? Troubleshooting

| Problem | Solution |
|---|---|
| **"TELEGRAM_BOT_TOKEN not set"** | Ensure `.env` exists and restart the server |
| **Can't find Chat ID** | Send a message in the group, then click "Check bot updates" in Settings |
| **Upload fails at chunk** | Verify bot has admin rights; check `TELEGRAM_CHAT_ID` is a negative number |
| **Downloaded file is corrupt** | Check all parts uploaded; inspect the `parts` jsonb in Supabase |
| **Session expires immediately** | `SESSION_SECRET` must be a stable value — don't rotate while sessions are active |
| **Supabase RLS blocking inserts** | Use the **service role key**, not the anon key |

---

## ?? License

MIT — free to fork, self-host, and adapt for personal use.

---

## ?? Acknowledgements

- [Telegram Bot API](https://core.telegram.org/bots/api) — free, reliable file storage backbone
- [Supabase](https://supabase.com) — zero-config PostgreSQL backend
- [TanStack](https://tanstack.com) — excellent React meta-framework ecosystem
- [shadcn/ui](https://ui.shadcn.com) — beautifully composable component library
