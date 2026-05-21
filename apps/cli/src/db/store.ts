import Database from "better-sqlite3";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Manifest } from "@discvault/core";

export interface FileRecord {
  id: string;
  title: string;
  filename: string;
  size: number;
  mimeType: string | null;
  totalChunks: number;
  fileSha256: string;
  createdAt: string;
  manifest: Manifest;
}

// Matches actual SQLite column names (snake_case)
export interface UploadStateRow {
  file_id: string;
  chunk_index: number;
  status: "pending" | "uploaded" | "failed";
  message_id: string | null;
  channel_id: string | null;
  chunk_sha256: string | null;
}

let _db: Database.Database | null = null;

export async function openDb(dbPath: string): Promise<Database.Database> {
  if (_db) return _db;
  await mkdir(dirname(dbPath), { recursive: true });
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  runMigrations(_db);
  return _db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      filename      TEXT NOT NULL,
      size          INTEGER NOT NULL,
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
  `);
}

export function saveFile(db: Database.Database, manifest: Manifest): void {
  db.prepare(`
    INSERT OR REPLACE INTO files
      (id, title, filename, size, mime_type, total_chunks, file_sha256, created_at, manifest_json)
    VALUES
      (@id, @title, @filename, @size, @mimeType, @totalChunks, @fileSha256, @createdAt, @manifestJson)
  `).run({
    id: manifest.fileId,
    title: manifest.title,
    filename: manifest.originalFilename,
    size: manifest.size,
    mimeType: manifest.mimeType,
    totalChunks: manifest.totalChunks,
    fileSha256: manifest.fileSha256,
    createdAt: manifest.createdAt,
    manifestJson: JSON.stringify(manifest),
  });
}

export function getFile(db: Database.Database, fileId: string): FileRecord | null {
  const row = db
    .prepare("SELECT * FROM files WHERE id = ?")
    .get(fileId) as RawFileRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function listFiles(db: Database.Database): FileRecord[] {
  const rows = db
    .prepare("SELECT * FROM files ORDER BY created_at DESC")
    .all() as RawFileRow[];
  return rows.map(rowToRecord);
}

export function deleteFile(db: Database.Database, fileId: string): boolean {
  const result = db.prepare("DELETE FROM files WHERE id = ?").run(fileId);
  db.prepare("DELETE FROM upload_state WHERE file_id = ?").run(fileId);
  return result.changes > 0;
}

export function initUploadState(
  db: Database.Database,
  fileId: string,
  totalChunks: number
): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO upload_state (file_id, chunk_index, status, message_id, channel_id)
    VALUES (@fileId, @chunkIndex, 'pending', NULL, NULL)
  `);
  const insertMany = db.transaction(() => {
    for (let i = 0; i < totalChunks; i++) {
      insert.run({ fileId, chunkIndex: i });
    }
  });
  insertMany();
}

export function markChunkUploaded(
  db: Database.Database,
  fileId: string,
  chunkIndex: number,
  messageId: string,
  channelId: string,
  chunkSha256: string
): void {
  db.prepare(`
    UPDATE upload_state
    SET status = 'uploaded', message_id = ?, channel_id = ?, chunk_sha256 = ?
    WHERE file_id = ? AND chunk_index = ?
  `).run(messageId, channelId, chunkSha256, fileId, chunkIndex);
}

export function markChunkFailed(
  db: Database.Database,
  fileId: string,
  chunkIndex: number
): void {
  db.prepare(`
    UPDATE upload_state SET status = 'failed' WHERE file_id = ? AND chunk_index = ?
  `).run(fileId, chunkIndex);
}

export function getPendingChunks(
  db: Database.Database,
  fileId: string
): UploadStateRow[] {
  return db
    .prepare(
      "SELECT * FROM upload_state WHERE file_id = ? AND status != 'uploaded' ORDER BY chunk_index"
    )
    .all(fileId) as UploadStateRow[];
}

export function getUploadedChunks(
  db: Database.Database,
  fileId: string
): UploadStateRow[] {
  return db
    .prepare(
      "SELECT * FROM upload_state WHERE file_id = ? AND status = 'uploaded' ORDER BY chunk_index"
    )
    .all(fileId) as UploadStateRow[];
}

interface RawFileRow {
  id: string;
  title: string;
  filename: string;
  size: number;
  mime_type: string | null;
  total_chunks: number;
  file_sha256: string;
  created_at: string;
  manifest_json: string;
}

function rowToRecord(row: RawFileRow): FileRecord {
  return {
    id: row.id,
    title: row.title,
    filename: row.filename,
    size: row.size,
    mimeType: row.mime_type,
    totalChunks: row.total_chunks,
    fileSha256: row.file_sha256,
    createdAt: row.created_at,
    manifest: JSON.parse(row.manifest_json) as Manifest,
  };
}
