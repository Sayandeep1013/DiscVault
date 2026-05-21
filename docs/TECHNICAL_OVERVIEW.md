# DiscVault — Technical Overview
### A developer's walkthrough from problem to production

---

## 1. The Problem

I needed a way to store large files — primarily videos, 2GB to 30GB in size — and share them with a small group of friends, without paying for cloud storage or an external hard drive.

The key constraints were:
- **Free** — no monthly storage bill
- **Shareable** — friends can download files without manual file transfers
- **Reliable enough** — not production-grade, but not fragile either
- **Private** — files should not be publicly accessible

The observation: Discord already supports file attachments up to **10MB per message** on free servers. If you could split a large file into 10MB pieces and upload each piece as a Discord message, the total storage is theoretically unlimited — bounded only by Discord's message history.

This is the core idea behind DiscVault.

---

## 2. Why This Works (and Why It's Non-Trivial)

The naive version of this idea is easy to describe but hard to implement correctly:

1. Split file → upload pieces → download pieces → join them back.

The real challenges are:

- **Integrity** — how do you know the file reconstructed correctly after thousands of network round-trips? A single corrupted byte in a video makes it unplayable.
- **Scale** — a 30GB video becomes ~3,400 chunks. Uploading 3,400 files sequentially would take hours. Too many parallel uploads hit Discord's rate limits.
- **Memory** — you cannot load a 30GB file into RAM, split it, and upload it. The system must work as a stream.
- **Manifest** — after uploading 3,400 chunks across multiple Discord channels, how do you remember where each one is?
- **Resume** — what happens when an upload fails at chunk 2,847? You can't restart from chunk 0.
- **Multi-user** — how do friends access files without sharing your bot token directly?

Each of these required deliberate design decisions.

---

## 3. Architecture Overview

The project is a **pnpm monorepo** with this structure:

```
DiscVault/
├── packages/
│   ├── core/              # Chunker, SHA-256 hashing, manifest schema, file rebuilder
│   └── discord-adapter/   # Discord REST API client — upload and download chunks
├── apps/
│   ├── cli/               # Command-line tool: discvault upload / download / list
│   └── web/               # Next.js web dashboard + API backend
└── render.yaml            # Deployment config for Render.com
```

The monorepo pattern means the core logic — chunking, hashing, manifests — is written once and shared across both the CLI and the web app. Neither duplicates logic.

---

## 4. The Core Protocol (`packages/core`)

### 4.1 Chunking

Files are read using a **Node.js async generator** that yields 9MB buffers:

```typescript
async function* chunkFile(filePath, chunkSize = 9MB): AsyncGenerator<Chunk> {
  const stream = createReadStream(filePath, { highWaterMark: chunkSize });
  let index = 0;
  for await (const data of stream) {
    yield { index: index++, data, sha256: hashBuffer(data) };
  }
}
```

The chunk size is **9MB** (not 10MB) to stay safely under Discord's 10MB attachment limit with room for HTTP headers.

Key decision: **no Base64 encoding**. Many tutorials encode chunks as Base64 text, which inflates file size by 33%. Discord supports binary file attachments directly, so chunks are uploaded as raw `.bin` files.

### 4.2 SHA-256 Verification

Every chunk gets a SHA-256 hash computed as it's read. The full file also gets a SHA-256 hash computed in the same streaming pass. These are stored in the manifest.

On download, every chunk's hash is verified before writing to disk. After the file is fully assembled, the full-file hash is verified against the original. If anything doesn't match — corruption during upload, a partially-downloaded chunk, a wrong file — it's caught deterministically.

```
Upload: file → SHA-256(file), SHA-256(each chunk) → store in manifest
Download: download chunk → verify SHA-256 → write → after all chunks: verify SHA-256(file)
```

### 4.3 The Manifest

The manifest is a JSON document — the "map" of the entire upload:

```json
{
  "version": 1,
  "fileId": "vv_jec3xKgmF5",
  "title": "Wedding Video",
  "originalFilename": "wedding.mp4",
  "size": 2415919104,
  "mimeType": "video/mp4",
  "chunkSize": 9437184,
  "totalChunks": 256,
  "fileSha256": "a3f8...",
  "createdAt": "2026-05-21T07:00:00.000Z",
  "chunks": [
    {
      "index": 0,
      "discordGuildId": "...",
      "discordChannelId": "...",
      "discordMessageId": "1506858873716347090",
      "attachmentName": "vv_jec3xKgmF5.part000000.bin",
      "chunkSha256": "b2e1..."
    },
    ...
  ]
}
```

After a successful upload, this manifest is posted as a JSON file attachment to a dedicated `manifests` Discord channel. This makes it discoverable by anyone with bot access to the same server — the manifest channel is the shared library.

### 4.4 File Rebuilder

The rebuilder takes a manifest and a `getChunkData(index)` function, writes chunks to an output file in order, then verifies the SHA-256:

```typescript
async function rebuildFile({ outputPath, manifest, getChunkData }) {
  const writer = createWriteStream(outputPath);
  for (let i = 0; i < manifest.totalChunks; i++) {
    const data = await getChunkData(i);
    await writeChunk(writer, data);
  }
  const actualHash = await hashFile(outputPath);
  if (actualHash !== manifest.fileSha256) throw new Error("SHA-256 mismatch");
}
```

This is tested with 12 unit tests covering: hash correctness, chunk count accuracy, last-chunk size, end-to-end reconstruct, and mismatch detection.

---

## 5. The Discord Adapter (`packages/discord-adapter`)

### 5.1 REST-only, no WebSocket

A common misconception: you need a running Discord bot (WebSocket connection) to upload files. You don't. Discord has a full REST API. All we need is a bot token and HTTP calls.

We use `@discordjs/rest` in pure REST mode — no gateway, no event handlers, no slash commands. The bot token is just an API key for making HTTP requests.

### 5.2 Uploading Chunks

**First approach (wrong):** Used `FormData` with `passThroughBody: true`:
```typescript
// This didn't work
formData.append("files[0]", new Blob([data]), filename);
rest.post(Routes.channelMessages(channelId), { body: formData, passThroughBody: true });
```

**Root cause:** `@discordjs/rest` v2 changed its file upload API. The `passThroughBody` approach was from older documentation.

**Fix:** The correct `@discordjs/rest` v2 file upload API:
```typescript
rest.post(Routes.channelMessages(channelId), {
  files: [{ data, name: filename, contentType: "application/octet-stream" }],
  body: { attachments: [{ id: "0", filename }] },
});
```

### 5.3 Rate Limiting

Discord enforces rate limits (~5 messages/second per channel). Uploading 3,400 chunks at full speed would result in sustained 429 responses.

Solution: `p-limit` with concurrency of 3, spread across multiple vault channels in round-robin. Rate limit 429 responses trigger exponential backoff using the `Retry-After` header.

### 5.4 Downloading

Downloads hit the Discord CDN directly via `fetch()`. CDN URLs are returned from reading the message. Each chunk is verified against its stored SHA-256 before being accepted.

---

## 6. The CLI (`apps/cli`)

### 6.1 Commands

```bash
discvault init       # Interactive setup: bot token, guild ID, channel IDs
discvault upload <file> --title "Name"
discvault download <fileId> -o output.mp4
discvault list
discvault share <fileId>
```

### 6.2 Resumable Uploads

Every upload gets an `upload_state` table in SQLite tracking per-chunk status:

```sql
CREATE TABLE upload_state (
  file_id      TEXT,
  chunk_index  INTEGER,
  status       TEXT,   -- 'pending' | 'uploaded' | 'failed'
  message_id   TEXT,
  channel_id   TEXT,
  chunk_sha256 TEXT,
  PRIMARY KEY (file_id, chunk_index)
);
```

On upload start, all chunks are inserted as `pending`. As each uploads successfully, it's updated to `uploaded`. On re-run of the same upload, chunks already marked `uploaded` are skipped — the file is streamed again but those chunks' upload tasks are not pushed to the queue.

### 6.3 Critical Bug: camelCase vs snake_case

The most subtle bug in the entire project.

`better-sqlite3` returns column names exactly as they appear in the SQL schema (`snake_case`: `chunk_index`, `file_id`). The TypeScript interface used camelCase (`chunkIndex`, `fileId`).

```typescript
// Interface said this:
interface UploadStateRow { chunkIndex: number; ... }

// But SQLite returned this:
{ chunk_index: 2, file_id: "vv_..." }

// So this was always an empty set:
const pendingIndexes = new Set(rows.map(r => r.chunkIndex)); // Set([undefined])

// And this was always false:
pendingIndexes.has(0) // false — chunk skipped silently!
```

Every chunk was silently skipped. The upload appeared to run (no errors) but nothing was actually sent to Discord. The `upload_state` rows remained `pending`, so the final check `getPendingChunks()` found them all and reported failure.

Fix: rename the TypeScript interface fields to match the actual SQL column names (`chunk_index`, `file_id`, etc.).

---

## 7. The Web Dashboard (`apps/web`)

### 7.1 Stack

- **Next.js 15** with App Router — handles both the React frontend and the backend API routes in one deployment
- **Tailwind CSS** with a custom **blueprint engineering** theme: deep navy background, dot-grid overlay, cyan accents, monospace font
- **PostgreSQL (Neon)** — cloud database, free tier, no data expiry
- **Discord OAuth2** for user authentication

### 7.2 Streaming Upload

**Problem:** A browser can't load a 30GB file into memory. `fetch()` can stream a file body, but Next.js's `request.formData()` buffers the entire body before returning.

**Solution:** Send the file as a raw binary body (`Content-Type: application/octet-stream`) with filename/title as request headers. Read `request.body` as a `ReadableStream<Uint8Array>` on the server, re-chunk it in 9MB pieces with a custom rechunker:

```typescript
async function* rechunk(stream, chunkSize = 9MB) {
  const reader = stream.getReader();
  let buffer = Buffer.alloc(0);
  while (true) {
    const { done, value } = await reader.read();
    if (done) { if (buffer.length > 0) yield buffer; break; }
    buffer = Buffer.concat([buffer, Buffer.from(value)]);
    while (buffer.length >= chunkSize) {
      yield Buffer.from(buffer.subarray(0, chunkSize));
      buffer = Buffer.from(buffer.subarray(chunkSize));
    }
  }
}
```

Server RAM usage: O(chunk_size) = ~9MB regardless of file size.

Progress is streamed back to the browser as **Server-Sent Events** in the same response body.

### 7.3 Streaming Download — The Crash

**Problem:** Initial download implementation:
```typescript
// Buffered everything in server RAM:
const combined = Buffer.concat(chunkBuffers); // 2.3 GB in RAM
return new NextResponse(combined, ...);       // sent all at once
// Browser then loaded 2.3 GB as a Blob
// Total: ~4.6 GB RAM → browser crash
```

**Fix:** Stream chunks one at a time from Discord CDN directly into the browser's download stream:

```typescript
const stream = new ReadableStream({
  async start(controller) {
    for (const chunk of manifest.chunks) {
      const data = await downloadChunkFromDiscord(chunk);
      controller.enqueue(data); // 9 MB at a time
    }
    controller.close();
  }
});
return new Response(stream, { headers: { "Content-Disposition": ... } });
```

On the client: instead of `fetch()` + `blob()`, use a plain anchor tag click:
```typescript
const a = document.createElement("a");
a.href = `/api/download/${fileId}`;
a.click();
```

This hands control to the browser's native download manager, which streams to disk without any JavaScript memory allocation.

### 7.4 Filename Encoding Bug

Downloaded files had names like `%E0%A6%BE%E0%A6%A8%E0%A7%8D...` instead of the actual Bengali characters.

**Root cause:** `Content-Disposition: attachment; filename="${encodeURIComponent(name)}"` — the browser treats the value as literal text, not URL-encoded. It displays the `%XX` sequences as-is.

**Fix:** RFC 5987 encoding:
```
Content-Disposition: attachment; filename="fallback.mp4"; filename*=UTF-8''%E0%A6%BE...
```

The `filename*=UTF-8''` prefix tells the browser this is UTF-8 URL-encoded, which it decodes correctly.

### 7.5 Authentication

**Architecture:** Discord OAuth2 ("Sign in with Discord") for identity. Each user stores their own bot configuration (token, server ID, channel IDs) server-side encrypted.

**Two separate Discord applications:**
- **OAuth2 App** (DiscVaultAuth) — used for login, reads only the user's Discord username. Created once by the service developer.
- **Bot** — used for uploading/downloading chunks. Created by each user for their own Discord server.

This separation means DiscVault never needs admin access to your server. Your bot lives in your server under your control.

**Bot token encryption:** AES-256-GCM. Each token gets a unique 96-bit IV. The 128-bit GCM auth tag is stored alongside to detect tampering. The decryption key lives only in the server's `ENCRYPTION_KEY` environment variable.

### 7.6 OAuth2 Cookie Bug

**Problem:** After Discord redirected back to the callback, the session cookie wasn't reaching the browser.

**Root cause:** A `307 Temporary Redirect` response with `Set-Cookie` headers. Some browsers don't reliably process `Set-Cookie` on redirect responses before following the redirect — especially when the redirect chain crosses domains (Discord → our server).

**Fix:** Return a `200` response with a tiny HTML page that sets the cookie in the initial response body, then uses `window.location.replace()` for the navigation. The browser processes the cookie from the 200 response before any navigation occurs.

```typescript
const html = `<script>window.location.replace("${redirectTo}");</script>`;
const res = new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html" } });
res.cookies.set("dv_session", sessionToken, { httpOnly: true, sameSite: "lax", ... });
return res;
```

---

## 8. Database Design

### 8.1 SQLite → PostgreSQL

Started with `better-sqlite3` (synchronous, local file). Works perfectly for the CLI on a single machine.

For production deployment on a cloud server (Render.com), local file storage resets on every restart. Migrated to **PostgreSQL** (Neon — free, serverless, never resets).

The migration required:
- Replacing all synchronous DB calls with async/await
- Changing parameter placeholders from `?` to `$1, $2, ...`
- Updating `INSERT OR IGNORE/REPLACE` to `ON CONFLICT DO NOTHING/UPDATE`

### 8.2 Schema

```sql
users         -- Discord user ID, username, avatar
sessions      -- Random 32-byte hex token, user_id, expiry, source (web/cli)
bot_configs   -- Per-user: encrypted bot token, guild ID, channel IDs
files         -- Manifest cache (fast local lookup)
upload_state  -- Per-chunk upload progress (for resume)
```

---

## 9. Deployment

### 9.1 Render.com

Render hosts the Next.js app as a Node.js web service. The monorepo build command:

```bash
npm install -g pnpm && \
pnpm install && \
pnpm --filter @discvault/core build && \
pnpm --filter @discvault/discord-adapter build && \
pnpm --filter @discvault/web build
```

**Node.js version issue:** Render's default Node.js 26.2.0 is too new for `better-sqlite3` (used by the CLI package) — the V8 API changed and the native binding wouldn't compile. Fixed by adding `.nvmrc` pinning Node to `20` (LTS), which has prebuilt binaries.

### 9.2 Free tier constraints

| Concern | Reality |
|---|---|
| RAM | Fine — we stream 9MB chunks, not whole files |
| Spin-down | Mitigated by UptimeRobot pinging `/api/health` every 5 minutes |
| Bandwidth | 100GB/month free — fine for small groups |
| Database | Neon free Postgres — 512MB, no data expiry |

---

## 10. What Was Intentionally Left Out (for now)

- **Encryption at upload time** — planned: AES-256-GCM per file, key embedded in share link fragment (`#key=...`) so it never reaches the server
- **CLI as npm package** (`npm install -g discvault`) — next step
- **Desktop app (Tauri)** — for 30GB+ files without browser constraints
- **Mobile app (Expo/React Native)** — for browsing and smaller downloads
- **Analytics** — lightweight usage tracking
- **Redundancy/parity** — if a Discord message is deleted, the chunk is gone forever; Reed-Solomon parity chunks would fix this

---

## 11. Key Takeaways

1. **Streaming is non-negotiable for large files.** Any approach that buffers the entire file — client-side, server-side, or in the Discord API call — will OOM crash at scale. Every layer of the pipeline must stream.

2. **Integrity verification is the feature.** Without SHA-256 at both the chunk and file level, you're just hoping things worked. With it, you have a guarantee.

3. **The manifest IS the system.** Lose the manifest, lose the file. Storing the manifest on Discord itself (in the manifests channel) is what makes the system self-contained — the storage layer also holds its own index.

4. **Discord is an experimental backend.** It works, but it's not designed for this. Rate limits, CDN URL expiry, message deletion, and potential ToS changes are all real risks. The architecture abstracts Discord behind a storage adapter interface so it can be swapped out.

5. **Browser APIs have surprising limits.** A 2.3GB `Blob` in JavaScript crashes Chrome. The solution — letting the browser's native download manager handle the stream — is not intuitive but is the right architectural choice.
