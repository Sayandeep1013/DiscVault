import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chunkFile, collectChunks, getChunkPlan } from "../chunker.js";
import { hashBuffer, hashFile } from "../hash.js";
import { rebuildFile } from "../rebuild.js";
import { chunkAttachmentName, createManifest, manifestFilename, parseManifest } from "../manifest.js";

const MB = 1024 * 1024;

let tmpDir: string;
let testFilePath: string;
let testFileSize: number;
let testFileSha256: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "discvault-test-"));

  // 25 MB test file with deterministic content
  testFileSize = 25 * MB;
  const buf = Buffer.alloc(testFileSize);
  for (let i = 0; i < testFileSize; i++) {
    buf[i] = i % 256;
  }
  testFilePath = join(tmpDir, "test.bin");
  await writeFile(testFilePath, buf);
  testFileSha256 = createHash("sha256").update(buf).digest("hex");
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("hashBuffer / hashFile", () => {
  it("produces consistent SHA-256 for a buffer", () => {
    const buf = Buffer.from("hello discvault");
    const hash = hashBuffer(buf);
    expect(hash).toHaveLength(64);
    expect(hashBuffer(buf)).toBe(hash);
  });

  it("hashFile matches Buffer hash for test file", async () => {
    const actual = await hashFile(testFilePath);
    expect(actual).toBe(testFileSha256);
  });
});

describe("getChunkPlan", () => {
  it("computes correct chunk count for 9 MB chunks", async () => {
    const plan = await getChunkPlan(testFilePath, 9 * MB);
    expect(plan.fileSize).toBe(testFileSize);
    expect(plan.chunkSize).toBe(9 * MB);
    // 25 MB / 9 MB = ceil(2.77) = 3 chunks
    expect(plan.totalChunks).toBe(3);
  });

  it("computes correct chunk count for exact-fit chunks", async () => {
    const plan = await getChunkPlan(testFilePath, 5 * MB);
    expect(plan.totalChunks).toBe(5);
  });
});

describe("chunkFile", () => {
  it("produces chunks that reconstruct to original SHA-256", async () => {
    const chunkSize = 9 * MB;
    const chunks = await collectChunks(testFilePath, chunkSize);

    expect(chunks.length).toBe(3);
    expect(chunks[0]!.index).toBe(0);
    expect(chunks[1]!.index).toBe(1);
    expect(chunks[2]!.index).toBe(2);

    // Each chunk hash is correct
    for (const chunk of chunks) {
      expect(chunk.sha256).toBe(hashBuffer(chunk.data));
    }

    // Reconstruct and verify
    const combined = Buffer.concat(chunks.map((c) => c.data));
    const combinedHash = hashBuffer(combined);
    expect(combinedHash).toBe(testFileSha256);
    expect(combined.length).toBe(testFileSize);
  });

  it("last chunk is smaller when file size is not a multiple of chunk size", async () => {
    const chunkSize = 9 * MB;
    const chunks = await collectChunks(testFilePath, chunkSize);
    const lastChunk = chunks[chunks.length - 1]!;
    expect(lastChunk.data.length).toBe(testFileSize - (chunks.length - 1) * chunkSize);
  });
});

describe("manifest", () => {
  it("creates and parses a manifest round-trip", () => {
    const manifest = createManifest({
      fileId: "vv_test123456",
      title: "Test File",
      originalFilename: "test.bin",
      size: testFileSize,
      mimeType: "application/octet-stream",
      chunkSize: 9 * MB,
      totalChunks: 3,
      fileSha256: testFileSha256,
      chunks: [],
    });

    expect(manifest.version).toBe(1);
    expect(manifest.fileId).toBe("vv_test123456");

    const parsed = parseManifest(JSON.parse(JSON.stringify(manifest)));
    expect(parsed.fileId).toBe(manifest.fileId);
    expect(parsed.fileSha256).toBe(manifest.fileSha256);
  });

  it("generates correct attachment names", () => {
    expect(chunkAttachmentName("vv_abc123", 0)).toBe("vv_abc123.part000000.bin");
    expect(chunkAttachmentName("vv_abc123", 42)).toBe("vv_abc123.part000042.bin");
    expect(chunkAttachmentName("vv_abc123", 999999)).toBe("vv_abc123.part999999.bin");
  });

  it("generates correct manifest filename", () => {
    expect(manifestFilename("vv_abc123")).toBe("vv_abc123.manifest.json");
  });

  it("throws on invalid manifest", () => {
    expect(() => parseManifest(null)).toThrow();
    expect(() => parseManifest({ version: 2 })).toThrow("Unsupported manifest version");
    expect(() => parseManifest({ version: 1 })).toThrow("Missing fileId");
  });
});

describe("rebuildFile", () => {
  it("reconstructs a file byte-for-byte from chunks", async () => {
    const chunkSize = 9 * MB;
    const chunks = await collectChunks(testFilePath, chunkSize);

    const manifest = createManifest({
      fileId: "vv_rebuildtest",
      title: "Rebuild Test",
      originalFilename: "test.bin",
      size: testFileSize,
      mimeType: "application/octet-stream",
      chunkSize,
      totalChunks: chunks.length,
      fileSha256: testFileSha256,
      chunks: chunks.map((c, i) => ({
        index: i,
        discordGuildId: "fake-guild",
        discordChannelId: "fake-channel",
        discordMessageId: `fake-msg-${i}`,
        attachmentName: chunkAttachmentName("vv_rebuildtest", i),
        chunkSha256: c.sha256,
      })),
    });

    const outputPath = join(tmpDir, "restored.bin");
    await rebuildFile({
      outputPath,
      manifest,
      getChunkData: async (index) => chunks[index]!.data,
    });

    const restoredHash = await hashFile(outputPath);
    expect(restoredHash).toBe(testFileSha256);
  });

  it("throws on SHA-256 mismatch", async () => {
    const chunkSize = 9 * MB;
    const chunks = await collectChunks(testFilePath, chunkSize);

    const manifest = createManifest({
      fileId: "vv_mismatchtest",
      title: "Mismatch Test",
      originalFilename: "test.bin",
      size: testFileSize,
      mimeType: "application/octet-stream",
      chunkSize,
      totalChunks: chunks.length,
      fileSha256: "0000000000000000000000000000000000000000000000000000000000000000",
      chunks: [],
    });

    const outputPath = join(tmpDir, "mismatch.bin");
    await expect(
      rebuildFile({
        outputPath,
        manifest,
        getChunkData: async (index) => chunks[index]!.data,
      })
    ).rejects.toThrow("SHA-256 mismatch");
  });
});
