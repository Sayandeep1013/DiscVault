import { NextRequest } from "next/server";
import { resolveConfig } from "@/lib/config-resolver";
import { rechunk, DEFAULT_CHUNK_SIZE } from "@/lib/rechunk";
import { saveFile, initUploadState, markChunkUploaded, markChunkFailed, getPendingChunks } from "@/lib/db";
import { createDiscordClient, uploadChunk } from "@discvault/discord-adapter";
import { hashBuffer, createManifest, chunkAttachmentName } from "@discvault/core";
import type { ChunkMeta } from "@discvault/core";
import { getMimeType } from "./mime";
import pLimit from "p-limit";
import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", 10);

// Use 4 concurrent uploads per vault channel, capped at Discord's global limit of 50 req/s
function getConcurrency(channelCount: number): number {
  return Math.min(channelCount * 4, 40);
}

export const dynamic = "force-dynamic";

// Disable Next.js body parsing — we read the stream directly
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const send = (controller: ReadableStreamDefaultController, data: object) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const resolved = await resolveConfig(req);
        if (!resolved) {
          send(controller, { type: "error", message: "Not configured. Sign in and set up your bot first." });
          controller.close();
          return;
        }
        const config = resolved.config;

        const filename = decodeURIComponent(req.headers.get("x-filename") ?? "upload");
        const title = decodeURIComponent(req.headers.get("x-title") ?? filename);
        const totalSizeHeader = req.headers.get("content-length");
        const totalSize = totalSizeHeader ? parseInt(totalSizeHeader, 10) : 0;

        if (!req.body) {
          send(controller, { type: "error", message: "No file body received" });
          controller.close();
          return;
        }

        const rest = createDiscordClient({ botToken: config.botToken });
        const fileId = "vv_" + nanoid();
        const mimeType = getMimeType(filename);
        const channelCount = config.vaultChannelIds.length;

        send(controller, { type: "start", fileId, filename, title });

        // Collect chunks first to know totalChunks, then upload
        // For streaming: we process and upload simultaneously
        const uploadedChunks: ChunkMeta[] = [];
        const limit = pLimit(getConcurrency(channelCount));
        const uploadTasks: Promise<void>[] = [];
        let chunkIndex = 0;
        let bytesHashed = 0;
        const { createHash } = await import("node:crypto");
        const fileHasher = createHash("sha256");

        for await (const chunkData of rechunk(req.body, DEFAULT_CHUNK_SIZE)) {
          fileHasher.update(chunkData);
          bytesHashed += chunkData.length;
          const chunkSha256 = hashBuffer(chunkData);
          const channelId = config.vaultChannelIds[chunkIndex % channelCount]!;
          const attachmentName = chunkAttachmentName(fileId, chunkIndex);
          const idx = chunkIndex++;
          const dataSnapshot = chunkData;

          uploadTasks.push(
            limit(async () => {
              try {
                const result = await uploadChunk(rest, channelId, attachmentName, dataSnapshot);
                uploadedChunks[idx] = {
                  index: idx,
                  discordGuildId: config.guildId,
                  discordChannelId: result.channelId,
                  discordMessageId: result.messageId,
                  attachmentName,
                  chunkSha256,
                };
                send(controller, {
                  type: "progress",
                  chunk: idx + 1,
                  total: -1, // unknown until stream ends
                  bytes: bytesHashed,
                  totalBytes: totalSize,
                });
              } catch (err) {
                throw new Error(`Chunk ${idx} failed: ${err instanceof Error ? err.message : String(err)}`);
              }
            })
          );
        }

        const totalChunks = chunkIndex;
        const fileSha256 = fileHasher.digest("hex");

        await Promise.all(uploadTasks);

        // Re-send final progress with correct totals
        send(controller, { type: "progress", chunk: totalChunks, total: totalChunks, bytes: bytesHashed, totalBytes: bytesHashed });

        const manifest = createManifest({
          fileId,
          title,
          originalFilename: filename,
          size: bytesHashed,
          mimeType,
          chunkSize: DEFAULT_CHUNK_SIZE,
          totalChunks,
          fileSha256,
          chunks: uploadedChunks,
        });

        await saveFile(manifest);

        // Post manifest to Discord
        const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), "utf-8");
        await uploadChunk(rest, config.manifestChannelId, `${fileId}.manifest.json`, manifestBuf);

        send(controller, { type: "done", fileId, title, size: bytesHashed });
      } catch (err) {
        send(controller, {
          type: "error",
          message: err instanceof Error ? err.message : "Upload failed",
        });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

