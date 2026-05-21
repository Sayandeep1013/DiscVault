import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { hashBuffer } from "./hash.js";

export const DEFAULT_CHUNK_SIZE = 9 * 1024 * 1024; // 9 MB — under Discord's 10 MB limit

export interface Chunk {
  index: number;
  data: Buffer;
  sha256: string;
}

export interface ChunkPlan {
  totalChunks: number;
  chunkSize: number;
  fileSize: number;
}

export async function getChunkPlan(
  filePath: string,
  chunkSize = DEFAULT_CHUNK_SIZE
): Promise<ChunkPlan> {
  const { size } = await stat(filePath);
  return {
    totalChunks: Math.ceil(size / chunkSize),
    chunkSize,
    fileSize: size,
  };
}

export async function* chunkFile(
  filePath: string,
  chunkSize = DEFAULT_CHUNK_SIZE
): AsyncGenerator<Chunk> {
  const stream = createReadStream(filePath, { highWaterMark: chunkSize });
  let index = 0;

  for await (const rawChunk of stream) {
    const data = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    yield {
      index: index++,
      data,
      sha256: hashBuffer(data),
    };
  }
}

export async function collectChunks(
  filePath: string,
  chunkSize = DEFAULT_CHUNK_SIZE
): Promise<Chunk[]> {
  const chunks: Chunk[] = [];
  for await (const chunk of chunkFile(filePath, chunkSize)) {
    chunks.push(chunk);
  }
  return chunks;
}
