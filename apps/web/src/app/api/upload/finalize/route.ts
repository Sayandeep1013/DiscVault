import { NextRequest, NextResponse } from "next/server";
import { resolveConfig } from "@/lib/config-resolver";
import { saveFile } from "@/lib/db";
import { uploadChunk, createDiscordClient } from "@discvault/discord-adapter";
import { createManifest } from "@discvault/core";
import type { ChunkMeta } from "@discvault/core";
import mime from "mime";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const resolved = await resolveConfig(req);
  if (!resolved) return NextResponse.json({ error: "Not configured" }, { status: 401 });

  const body = await req.json() as {
    fileId: string;
    filename: string;
    title?: string;
    size: number;
    chunks: Array<{
      index: number;
      messageId: string;
      channelId: string;
      guildId: string;
      chunkSha256: string;
    }>;
  };

  const { fileId, filename, title, size, chunks } = body;
  if (!fileId || !filename || !chunks?.length) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const chunkMetas: ChunkMeta[] = chunks.map((c) => ({
    index: c.index,
    discordGuildId: c.guildId,
    discordChannelId: c.channelId,
    discordMessageId: c.messageId,
    attachmentName: `${fileId}.part${String(c.index).padStart(6, "0")}.bin`,
    chunkSha256: c.chunkSha256,
  }));

  const manifest = createManifest({
    fileId,
    title: title ?? filename,
    originalFilename: filename,
    size,
    mimeType: mime.getType(filename) ?? "application/octet-stream",
    chunkSize: 9 * 1024 * 1024,
    totalChunks: chunks.length,
    fileSha256: "", // web uploads skip full-file hash; per-chunk SHA-256 provides integrity
    chunks: chunkMetas,
  });

  try {
    await saveFile(manifest);
  } catch (err) {
    console.error("saveFile failed:", err);
    return NextResponse.json({ error: "Database error saving manifest" }, { status: 500 });
  }

  // Post manifest JSON to Discord manifests channel
  try {
    const { config } = resolved;
    const rest = createDiscordClient({ botToken: config.botToken });
    const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), "utf-8");
    await uploadChunk(rest, config.manifestChannelId, `${fileId}.manifest.json`, manifestBuf);
  } catch (err) {
    console.error("manifest post failed:", err);
    // Non-fatal — manifest is saved in DB, file is recoverable
  }

  return NextResponse.json({ ok: true, fileId });
}
