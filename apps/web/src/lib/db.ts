import { Pool } from "pg";
import type { Manifest } from "@discvault/core";
import { decryptToken } from "./crypto";
import type { DiscVaultConfig } from "./config";

export interface BotConfig {
  id: string;
  userId: string;
  guildId: string;
  guildName: string;
  botUsername: string;
  vaultChannelIds: string[];
  manifestChannelId: string;
}

// ── Connection pool ────────────────────────────────────────────────────────────

let _pool: Pool | null = null;

function pool(): Pool {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _pool = new Pool({
      connectionString: url,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 60_000,       // keep connections alive longer
      connectionTimeoutMillis: 10_000, // fail fast if Neon is waking up
    });
    // Reset pool reference on any pool error so next request gets a fresh pool
    _pool.on("error", () => {
      _pool = null;
      _ready = false;
    });
  }
  return _pool;
}

// Retry a DB operation once if the connection was dead (Neon auto-suspend recovery)
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const msg = String(err);
    const isConnectionDrop =
      msg.includes("ECONNRESET") ||
      msg.includes("connection terminated") ||
      msg.includes("Connection terminated") ||
      msg.includes("timeout");
    if (isConnectionDrop) {
      _pool = null;
      _ready = false;
      await new Promise((r) => setTimeout(r, 800)); // wait for Neon to wake
      return fn(); // one retry
    }
    throw err;
  }
}

// Proxy that wraps every .query() call with withRetry.
// Must use .call(target, ...) to preserve `this` — without it pg's Pool.query throws.
function resilientPool(p: Pool): Pool {
  return new Proxy(p, {
    get(target, prop) {
      if (prop === "query") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (...args: any[]) => withRetry(() => (target.query as any).call(target, ...args));
      }
      return Reflect.get(target, prop);
    },
  }) as Pool;
}

let _ready = false;
async function db(): Promise<Pool> {
  if (!_ready) {
    await withRetry(() => pool().query(`
      CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        username    TEXT NOT NULL,
        avatar      TEXT,
        created_at  TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token       TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at  TEXT NOT NULL,
        source      TEXT NOT NULL DEFAULT 'web'
      );
      CREATE TABLE IF NOT EXISTS bot_configs (
        id                    TEXT PRIMARY KEY,
        user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        guild_id              TEXT NOT NULL,
        guild_name            TEXT NOT NULL DEFAULT '',
        bot_username          TEXT NOT NULL DEFAULT '',
        bot_token_encrypted   TEXT NOT NULL,
        vault_channel_ids     TEXT NOT NULL,
        manifest_channel_id   TEXT NOT NULL,
        created_at            TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS files (
        id            TEXT PRIMARY KEY,
        title         TEXT NOT NULL,
        filename      TEXT NOT NULL,
        size          BIGINT NOT NULL,
        mime_type     TEXT,
        total_chunks  INTEGER NOT NULL,
        file_sha256   TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        manifest_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS upload_state (
        file_id       TEXT NOT NULL,
        chunk_index   INTEGER NOT NULL,
        status        TEXT NOT NULL,
        message_id    TEXT,
        channel_id    TEXT,
        chunk_sha256  TEXT,
        PRIMARY KEY (file_id, chunk_index)
      );
    `));
    // Add new columns to existing tables (safe on Neon — no-op if already present)
    await withRetry(() => pool().query(`
      ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS guild_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS bot_username TEXT NOT NULL DEFAULT '';
    `));
    _ready = true;
  }
  return resilientPool(pool());
}

// ── User & Session ─────────────────────────────────────────────────────────────

export async function upsertUser(id: string, username: string, avatar: string | null): Promise<void> {
  await (await db()).query(
    `INSERT INTO users (id, username, avatar, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(id) DO UPDATE SET username = EXCLUDED.username, avatar = EXCLUDED.avatar`,
    [id, username, avatar, new Date().toISOString()]
  );
}

export async function createSession(token: string, userId: string, source: "web" | "cli" = "web"): Promise<void> {
  const days = source === "cli" ? 90 : 7;
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  await (await db()).query(
    `INSERT INTO sessions (token, user_id, expires_at, source) VALUES ($1, $2, $3, $4)`,
    [token, userId, expiresAt, source]
  );
}

export async function getUserBySession(
  token: string
): Promise<{ user_id: string; username: string; avatar: string | null } | null> {
  const { rows } = await (await db()).query(
    `SELECT u.id AS user_id, u.username, u.avatar
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > $2`,
    [token, new Date().toISOString()]
  );
  return (rows[0] as { user_id: string; username: string; avatar: string | null } | undefined) ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await (await db()).query(`DELETE FROM sessions WHERE token = $1`, [token]);
}

// ── Bot config ─────────────────────────────────────────────────────────────────

export async function saveBotConfig(
  userId: string,
  encryptedToken: string,
  guildId: string,
  vaultChannelIds: string[],
  manifestChannelId: string,
  guildName = "",
  botUsername = ""
): Promise<void> {
  // ID: bc_{userId}_{guildId} — supports multiple servers per user.
  // Legacy rows used bc_{userId}; those are migrated on first save.
  const id = `bc_${userId}_${guildId}`;
  await (await db()).query(
    `INSERT INTO bot_configs (id, user_id, guild_id, guild_name, bot_username, bot_token_encrypted, vault_channel_ids, manifest_channel_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT(id) DO UPDATE SET
       guild_name = EXCLUDED.guild_name,
       bot_username = EXCLUDED.bot_username,
       bot_token_encrypted = EXCLUDED.bot_token_encrypted,
       vault_channel_ids = EXCLUDED.vault_channel_ids,
       manifest_channel_id = EXCLUDED.manifest_channel_id`,
    [id, userId, guildId, guildName, botUsername, encryptedToken, JSON.stringify(vaultChannelIds), manifestChannelId, new Date().toISOString()]
  );
}

type RawBotConfigRow = {
  id: string; user_id: string; guild_id: string; guild_name: string; bot_username: string;
  bot_token_encrypted: string; vault_channel_ids: string; manifest_channel_id: string;
};

function rowToBotConfig(row: RawBotConfigRow): BotConfig {
  return {
    id: row.id,
    userId: row.user_id,
    guildId: row.guild_id,
    guildName: row.guild_name ?? "",
    botUsername: row.bot_username ?? "",
    vaultChannelIds: JSON.parse(row.vault_channel_ids) as string[],
    manifestChannelId: row.manifest_channel_id,
  };
}

// Returns the first/any config for a user — used by auth context
export async function getBotConfig(userId: string): Promise<BotConfig | null> {
  const { rows } = await (await db()).query(
    `SELECT * FROM bot_configs WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [userId]
  );
  const row = rows[0] as RawBotConfigRow | undefined;
  return row ? rowToBotConfig(row) : null;
}

// Returns ALL configs for a user (all connected servers)
export async function getAllBotConfigs(userId: string): Promise<BotConfig[]> {
  const { rows } = await (await db()).query(
    `SELECT * FROM bot_configs WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId]
  );
  return (rows as RawBotConfigRow[]).map(rowToBotConfig);
}

export async function removeBotConfig(userId: string, guildId: string): Promise<void> {
  // Handle both id formats: new bc_{userId}_{guildId} and legacy bc_{userId}
  await (await db()).query(
    `DELETE FROM bot_configs WHERE user_id = $1 AND guild_id = $2`,
    [userId, guildId]
  );
}

export async function getDecryptedBotToken(userId: string, guildId?: string): Promise<string | null> {
  let row: { bot_token_encrypted: string } | undefined;
  if (guildId) {
    const { rows } = await (await db()).query(
      `SELECT bot_token_encrypted FROM bot_configs WHERE user_id = $1 AND guild_id = $2`,
      [userId, guildId]
    );
    row = rows[0] as typeof row;
  } else {
    const { rows } = await (await db()).query(
      `SELECT bot_token_encrypted FROM bot_configs WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [userId]
    );
    row = rows[0] as typeof row;
  }
  if (!row) return null;
  return decryptToken(row.bot_token_encrypted);
}

export async function botConfigToDiscVaultConfig(botConfig: BotConfig): Promise<DiscVaultConfig> {
  const token = await getDecryptedBotToken(botConfig.userId, botConfig.guildId);
  if (!token) throw new Error("Bot token not found");
  return {
    botToken: token,
    guildId: botConfig.guildId,
    vaultChannelIds: botConfig.vaultChannelIds,
    manifestChannelId: botConfig.manifestChannelId,
  };
}

// ── Files & upload state ───────────────────────────────────────────────────────

export async function saveFile(manifest: Manifest): Promise<void> {
  await (await db()).query(
    `INSERT INTO files (id, title, filename, size, mime_type, total_chunks, file_sha256, created_at, manifest_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT(id) DO UPDATE SET manifest_json = EXCLUDED.manifest_json`,
    [manifest.fileId, manifest.title, manifest.originalFilename, manifest.size,
     manifest.mimeType, manifest.totalChunks, manifest.fileSha256,
     manifest.createdAt, JSON.stringify(manifest)]
  );
}

export async function initUploadState(fileId: string, totalChunks: number): Promise<void> {
  if (totalChunks === 0) return;
  const pg = await db();
  // Batch in groups of 500 rows to stay well under Postgres's 65535 param limit
  const BATCH = 500;
  for (let start = 0; start < totalChunks; start += BATCH) {
    const end = Math.min(start + BATCH, totalChunks);
    const values: string[] = [];
    const params: (string | number)[] = [];
    let p = 1;
    for (let i = start; i < end; i++) {
      values.push(`($${p++}, $${p++}, 'pending', NULL, NULL)`);
      params.push(fileId, i);
    }
    await pg.query(
      `INSERT INTO upload_state (file_id, chunk_index, status, message_id, channel_id)
       VALUES ${values.join(", ")} ON CONFLICT DO NOTHING`,
      params
    );
  }
}

export async function markChunkUploaded(
  fileId: string, chunkIndex: number,
  messageId: string, channelId: string, chunkSha256: string
): Promise<void> {
  await (await db()).query(
    `UPDATE upload_state SET status='uploaded', message_id=$1, channel_id=$2, chunk_sha256=$3
     WHERE file_id=$4 AND chunk_index=$5`,
    [messageId, channelId, chunkSha256, fileId, chunkIndex]
  );
}

export async function markChunkFailed(fileId: string, chunkIndex: number): Promise<void> {
  await (await db()).query(
    `UPDATE upload_state SET status='failed' WHERE file_id=$1 AND chunk_index=$2`,
    [fileId, chunkIndex]
  );
}

export async function getPendingChunks(fileId: string): Promise<
  Array<{ file_id: string; chunk_index: number; status: string; message_id: string | null; channel_id: string | null; chunk_sha256: string | null }>
> {
  const { rows } = await (await db()).query(
    `SELECT * FROM upload_state WHERE file_id=$1 AND status!='uploaded' ORDER BY chunk_index`,
    [fileId]
  );
  return rows as Array<{ file_id: string; chunk_index: number; status: string; message_id: string | null; channel_id: string | null; chunk_sha256: string | null }>;
}

export async function getUploadedChunks(fileId: string): Promise<
  Array<{ file_id: string; chunk_index: number; status: string; message_id: string; channel_id: string; chunk_sha256: string }>
> {
  const { rows } = await (await db()).query(
    `SELECT * FROM upload_state WHERE file_id=$1 AND status='uploaded' ORDER BY chunk_index`,
    [fileId]
  );
  return rows as Array<{ file_id: string; chunk_index: number; status: string; message_id: string; channel_id: string; chunk_sha256: string }>;
}
