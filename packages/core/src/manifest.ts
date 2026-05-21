export interface ChunkMeta {
  index: number;
  discordGuildId: string;
  discordChannelId: string;
  discordMessageId: string;
  attachmentName: string;
  chunkSha256: string;
}

export interface Manifest {
  version: 1;
  fileId: string;
  title: string;
  originalFilename: string;
  size: number;
  mimeType: string;
  chunkSize: number;
  totalChunks: number;
  fileSha256: string;
  createdAt: string;
  chunks: ChunkMeta[];
}

export interface ManifestInit {
  fileId: string;
  title: string;
  originalFilename: string;
  size: number;
  mimeType: string;
  chunkSize: number;
  totalChunks: number;
  fileSha256: string;
  chunks: ChunkMeta[];
}

export function createManifest(init: ManifestInit): Manifest {
  return {
    version: 1,
    ...init,
    createdAt: new Date().toISOString(),
  };
}

export function parseManifest(raw: unknown): Manifest {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Manifest must be an object");
  }
  const m = raw as Record<string, unknown>;

  if (m["version"] !== 1) throw new Error("Unsupported manifest version");
  if (typeof m["fileId"] !== "string") throw new Error("Missing fileId");
  if (typeof m["title"] !== "string") throw new Error("Missing title");
  if (typeof m["originalFilename"] !== "string") throw new Error("Missing originalFilename");
  if (typeof m["size"] !== "number") throw new Error("Missing size");
  if (typeof m["mimeType"] !== "string") throw new Error("Missing mimeType");
  if (typeof m["chunkSize"] !== "number") throw new Error("Missing chunkSize");
  if (typeof m["totalChunks"] !== "number") throw new Error("Missing totalChunks");
  if (typeof m["fileSha256"] !== "string") throw new Error("Missing fileSha256");
  if (typeof m["createdAt"] !== "string") throw new Error("Missing createdAt");
  if (!Array.isArray(m["chunks"])) throw new Error("Missing chunks array");

  return m as unknown as Manifest;
}

export function manifestFilename(fileId: string): string {
  return `${fileId}.manifest.json`;
}

export function chunkAttachmentName(fileId: string, index: number): string {
  return `${fileId}.part${String(index).padStart(6, "0")}.bin`;
}
