import { createWriteStream } from "node:fs";
import { hashFile } from "./hash.js";
import type { Manifest } from "./manifest.js";

export interface RebuildOptions {
  outputPath: string;
  manifest: Manifest;
  getChunkData: (chunkIndex: number) => Promise<Buffer>;
  onProgress?: (completed: number, total: number) => void;
}

export async function rebuildFile(opts: RebuildOptions): Promise<void> {
  const { outputPath, manifest, getChunkData, onProgress } = opts;

  const writer = createWriteStream(outputPath);
  const writeChunk = (data: Buffer) =>
    new Promise<void>((resolve, reject) => {
      if (!writer.write(data)) {
        writer.once("drain", resolve);
      } else {
        resolve();
      }
      writer.once("error", reject);
    });

  for (let i = 0; i < manifest.totalChunks; i++) {
    const data = await getChunkData(i);
    await writeChunk(data);
    onProgress?.(i + 1, manifest.totalChunks);
  }

  await new Promise<void>((resolve, reject) => {
    writer.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
  });

  // Only verify full-file SHA-256 if it was stored (CLI uploads store it; web uploads skip it)
  if (manifest.fileSha256) {
    const actualHash = await hashFile(outputPath);
    if (actualHash !== manifest.fileSha256) {
      throw new Error(
        `SHA-256 mismatch after rebuild. Expected ${manifest.fileSha256}, got ${actualHash}`
      );
    }
  }
}
