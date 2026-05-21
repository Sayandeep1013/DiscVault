import { NextRequest, NextResponse } from "next/server";
import { resolveConfig } from "@/lib/config-resolver";
import { uploadChunk } from "@discvault/discord-adapter";
import { createDiscordClient } from "@discvault/discord-adapter";
import { chunkAttachmentName } from "@discvault/core";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const resolved = await resolveConfig(req);
  if (!resolved) return NextResponse.json({ error: "Not configured" }, { status: 401 });

  const fileId = req.headers.get("x-file-id");
  const chunkIndexStr = req.headers.get("x-chunk-index");

  if (!fileId || chunkIndexStr === null) {
    return NextResponse.json({ error: "Missing x-file-id or x-chunk-index headers" }, { status: 400 });
  }

  const chunkIndex = parseInt(chunkIndexStr, 10);
  const { config } = resolved;
  const channelCount = config.vaultChannelIds.length;
  const channelId = config.vaultChannelIds[chunkIndex % channelCount]!;
  const attachmentName = chunkAttachmentName(fileId, chunkIndex);

  const data = Buffer.from(await req.arrayBuffer());
  const rest = createDiscordClient({ botToken: config.botToken });

  try {
    const result = await uploadChunk(rest, channelId, attachmentName, data);
    return NextResponse.json({
      messageId: result.messageId,
      channelId: result.channelId,
      guildId: config.guildId,
    });
  } catch (err) {
    console.error(`Chunk ${chunkIndex} upload failed:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Discord upload failed" },
      { status: 500 }
    );
  }
}
