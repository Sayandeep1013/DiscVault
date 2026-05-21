import { stat } from "node:fs/promises";
import { basename } from "node:path";
import cliProgress from "cli-progress";
import { nanoid } from "nanoid";
import pLimit from "p-limit";
import mime from "mime";
import {
  chunkFile,
  chunkAttachmentName,
  createManifest,
  hashFile,
  getChunkPlan,
  type ChunkMeta,
} from "@discvault/core";
import { createDiscordClient, uploadChunk, DiscordPermissionError } from "@discvault/discord-adapter";
import { loadConfig, DB_PATH } from "../config.js";
import { openDb } from "../db/store.js";
import {
  saveFile,
  initUploadState,
  markChunkUploaded,
  markChunkFailed,
  getPendingChunks,
  getUploadedChunks,
} from "../db/store.js";

export interface UploadOptions {
  title?: string;
}

const CONCURRENCY = 3;

export async function runUpload(filePath: string, opts: UploadOptions): Promise<void> {
  const config = await loadConfig();
  const db = await openDb(DB_PATH);
  const rest = createDiscordClient({ botToken: config.botToken });

  await stat(filePath); // throws if file not found
  const filename = basename(filePath);
  const title = opts.title ?? filename;
  const plan = await getChunkPlan(filePath);

  console.log(`\nFile:   ${filename}`);
  console.log(`Size:   ${formatBytes(plan.fileSize)}`);
  console.log(`Chunks: ${plan.totalChunks} × ${formatBytes(plan.chunkSize)}`);
  console.log(`\nHashing file...`);

  const fileSha256 = await hashFile(filePath);
  const mimeType = mime.getType(filename) ?? "application/octet-stream";
  const fileId = "vv_" + nanoid(10);

  console.log(`File ID: ${fileId}`);

  initUploadState(db, fileId, plan.totalChunks);

  const bar = new cliProgress.SingleBar(
    {
      format: "Uploading [{bar}] {percentage}% | {value}/{total} chunks | ETA: {eta}s",
      clearOnComplete: false,
    },
    cliProgress.Presets.shades_classic
  );
  bar.start(plan.totalChunks, 0);

  // Pre-populate already-uploaded chunks (resume support)
  const uploadedMap = new Map<number, { messageId: string; channelId: string; sha256: string }>();
  for (const row of getUploadedChunks(db, fileId)) {
    if (row.message_id && row.channel_id && row.chunk_sha256) {
      uploadedMap.set(row.chunk_index, {
        messageId: row.message_id,
        channelId: row.channel_id,
        sha256: row.chunk_sha256,
      });
    }
  }
  bar.update(uploadedMap.size);

  const pendingIndexes = new Set(getPendingChunks(db, fileId).map((r) => r.chunk_index));
  const channelCount = config.vaultChannelIds.length;
  const uploadLimiter = pLimit(CONCURRENCY);
  const pendingUploads: Promise<void>[] = [];

  for await (const chunk of chunkFile(filePath)) {
    if (!pendingIndexes.has(chunk.index)) continue;

    const channelId = config.vaultChannelIds[chunk.index % channelCount]!;
    const attachmentName = chunkAttachmentName(fileId, chunk.index);
    const chunkData = chunk.data;
    const chunkSha256 = chunk.sha256;
    const chunkIndex = chunk.index;

    pendingUploads.push(
      uploadLimiter(async () => {
        try {
          const result = await uploadChunk(rest, channelId, attachmentName, chunkData);
          markChunkUploaded(db, fileId, chunkIndex, result.messageId, result.channelId, chunkSha256);
          uploadedMap.set(chunkIndex, {
            messageId: result.messageId,
            channelId: result.channelId,
            sha256: chunkSha256,
          });
        } catch (err) {
          markChunkFailed(db, fileId, chunkIndex);
          bar.stop();
          if (err instanceof DiscordPermissionError) {
            console.error(`\n✗ ${err.message}\n`);
            process.exit(1);
          }
          console.error(`\n✗ Chunk ${chunkIndex} failed: ${err instanceof Error ? err.message : String(err)}\n`);
          throw err;
        } finally {
          bar.increment();
        }
      })
    );
  }

  await Promise.all(pendingUploads);
  bar.stop();

  const failedChunks = getPendingChunks(db, fileId);
  if (failedChunks.length > 0) {
    console.error(`\n✗ ${failedChunks.length} chunk(s) failed. Re-run to resume.\n`);
    process.exit(1);
  }

  const chunks: ChunkMeta[] = [];
  for (let i = 0; i < plan.totalChunks; i++) {
    const uploaded = uploadedMap.get(i);
    if (!uploaded) throw new Error(`Missing upload data for chunk ${i}`);
    chunks.push({
      index: i,
      discordGuildId: config.guildId,
      discordChannelId: uploaded.channelId,
      discordMessageId: uploaded.messageId,
      attachmentName: chunkAttachmentName(fileId, i),
      chunkSha256: uploaded.sha256,
    });
  }

  const manifest = createManifest({
    fileId,
    title,
    originalFilename: filename,
    size: plan.fileSize,
    mimeType,
    chunkSize: plan.chunkSize,
    totalChunks: plan.totalChunks,
    fileSha256,
    chunks,
  });

  saveFile(db, manifest);

  console.log("\nPosting manifest to Discord...");
  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), "utf-8");
  await uploadChunk(rest, config.manifestChannelId, `${fileId}.manifest.json`, manifestBuf);

  console.log(`\n✓ Upload complete!`);
  console.log(`  File ID: ${fileId}`);
  console.log(`  Share:   discvault download ${fileId}\n`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
