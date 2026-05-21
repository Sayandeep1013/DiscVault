import { NextRequest, NextResponse } from "next/server";
import { resolveConfig } from "@/lib/config-resolver";
import { createDiscordClient } from "@discvault/discord-adapter";
import { parseManifest, hashBuffer } from "@discvault/core";
import type { ChunkMeta, Manifest } from "@discvault/core";
import { Routes } from "discord-api-types/v10";

export const dynamic = "force-dynamic";
// No body size limit needed for download, but remove timeout for large files
export const maxDuration = 300;

async function findManifest(
  rest: ReturnType<typeof createDiscordClient>,
  manifestChannelId: string,
  fileId: string
): Promise<Manifest | null> {
  let before: string | undefined;
  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({ limit: "100" });
    if (before) params.set("before", before);

    const messages = (await rest.get(Routes.channelMessages(manifestChannelId), {
      query: params,
    })) as Array<{ id: string; attachments: Array<{ url: string; filename: string }> }>;

    if (messages.length === 0) break;

    for (const msg of messages) {
      for (const att of msg.attachments) {
        if (att.filename === `${fileId}.manifest.json`) {
          const res = await fetch(att.url);
          if (!res.ok) continue;
          return parseManifest(await res.json());
        }
      }
    }
    before = messages[messages.length - 1]?.id;
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;
  const resolved = await resolveConfig(_req);
  if (!resolved) return NextResponse.json({ error: "Not configured" }, { status: 404 });
  const { config } = resolved;

  const rest = createDiscordClient({ botToken: config.botToken });

  let manifest: Manifest | null;
  try {
    manifest = await findManifest(rest, config.manifestChannelId, fileId);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  if (!manifest) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const m = manifest;

  // Stream chunks one by one directly to the browser.
  // This keeps server RAM usage at ~1 chunk (9 MB) at a time regardless of file size.
  // The browser receives data progressively and streams it to disk via native download manager.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const chunk of m.chunks as ChunkMeta[]) {
          const msg = (await rest.get(
            Routes.channelMessage(chunk.discordChannelId, chunk.discordMessageId)
          )) as { attachments: Array<{ url: string }> };

          const att = msg.attachments[0];
          if (!att) throw new Error(`Missing attachment for chunk ${chunk.index}`);

          const res = await fetch(att.url);
          if (!res.ok) throw new Error(`HTTP ${res.status} fetching chunk ${chunk.index}`);

          const data = Buffer.from(await res.arrayBuffer());

          // Verify chunk integrity
          if (chunk.chunkSha256) {
            const actual = hashBuffer(data);
            if (actual !== chunk.chunkSha256) {
              throw new Error(`SHA-256 mismatch on chunk ${chunk.index}`);
            }
          }

          controller.enqueue(data);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  // RFC 5987 filename encoding — works for any Unicode filename in Chrome, Firefox, Safari
  const encoded = encodeURIComponent(m.originalFilename);
  const ascii = m.originalFilename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\/]/g, "_");

  return new Response(stream, {
    headers: {
      "Content-Type": m.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      "Content-Length": String(m.size),
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
