import { existsSync } from "node:fs";
import { join } from "node:path";
import cliProgress from "cli-progress";
import pLimit from "p-limit";
import { hashBuffer, rebuildFile, parseManifest, type Manifest, type ChunkMeta } from "@discvault/core";
import {
  createDiscordClient,
  downloadChunk,
  fetchManifestFromChannel,
} from "@discvault/discord-adapter";
import { loadConfig, DB_PATH } from "../config.js";
import { openDb, getFile, saveFile } from "../db/store.js";

export interface DownloadOptions {
  output?: string;
}

const CONCURRENCY = 4;

export async function runDownload(fileId: string, opts: DownloadOptions): Promise<void> {
  const config = await loadConfig();
  const db = await openDb(DB_PATH);
  const rest = createDiscordClient({ botToken: config.botToken });

  // Load manifest: local first, then Discord manifests channel
  let manifest: Manifest | null = null;
  const localRecord = getFile(db, fileId);

  if (localRecord) {
    manifest = localRecord.manifest;
    console.log(`\nManifest loaded from local database.`);
  } else {
    console.log(`\nManifest not found locally. Searching Discord...`);
    const remote = await fetchManifestFromChannel(rest, config.manifestChannelId, fileId);
    if (!remote) {
      console.error(`✗ File ID "${fileId}" not found on Discord or locally.`);
      process.exit(1);
    }
    manifest = parseManifest(remote);
    saveFile(db, manifest);
    console.log(`  Found and cached manifest from Discord.`);
  }

  const outputPath =
    opts.output ?? resolveOutputPath(manifest.originalFilename);

  console.log(`\nFile:    ${manifest.title}`);
  console.log(`Size:    ${formatBytes(manifest.size)}`);
  console.log(`Chunks:  ${manifest.totalChunks}`);
  console.log(`Output:  ${outputPath}\n`);

  // Download all chunks in parallel batches, write at correct byte offsets
  const bar = new cliProgress.SingleBar(
    {
      format: "Downloading [{bar}] {percentage}% | {value}/{total} chunks | ETA: {eta}s",
      clearOnComplete: false,
    },
    cliProgress.Presets.shades_classic
  );
  bar.start(manifest.totalChunks, 0);

  const chunkMap = new Map<number, Buffer>();
  const limit = pLimit(CONCURRENCY);

  await Promise.all(
    manifest.chunks.map((chunkMeta: ChunkMeta) =>
      limit(async () => {
        const data = await downloadChunk(
          rest,
          chunkMeta.discordChannelId,
          chunkMeta.discordMessageId,
          chunkMeta.chunkSha256
        );
        chunkMap.set(chunkMeta.index, data);
        bar.increment();
      })
    )
  );

  bar.stop();
  console.log("\nRebuilding file...");

  await rebuildFile({
    outputPath,
    manifest,
    getChunkData: async (index) => {
      const data = chunkMap.get(index);
      if (!data) throw new Error(`Missing chunk ${index} after download`);
      return data;
    },
  });

  console.log(`\n✓ Restored: ${outputPath}`);
  console.log(`  ${formatBytes(manifest.size)} | SHA-256 verified\n`);
}

function resolveOutputPath(originalFilename: string): string {
  if (!existsSync(originalFilename)) return originalFilename;
  const dot = originalFilename.lastIndexOf(".");
  const base = dot > 0 ? originalFilename.slice(0, dot) : originalFilename;
  const ext = dot > 0 ? originalFilename.slice(dot) : "";
  let i = 1;
  while (existsSync(`${base} (${i})${ext}`)) i++;
  return `${base} (${i})${ext}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
