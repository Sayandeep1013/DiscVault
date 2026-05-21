import { NextRequest, NextResponse } from "next/server";
import { resolveConfig } from "@/lib/config-resolver";
import { createDiscordClient } from "@discvault/discord-adapter";
import { parseManifest } from "@discvault/core";
import type { Manifest } from "@discvault/core";
import { Routes } from "discord-api-types/v10";

// In-memory cache: avoid hammering Discord on every page load
let cache: { manifests: Manifest[]; at: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function GET(req: NextRequest) {
  const resolved = await resolveConfig(req);
  if (!resolved) return NextResponse.json({ error: "Not configured" }, { status: 404 });
  const { config } = resolved;

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json({ files: cache.manifests });
  }

  const rest = createDiscordClient({ botToken: config.botToken });
  const manifests: Manifest[] = [];

  try {
    let before: string | undefined;
    for (let page = 0; page < 50; page++) {
      const params = new URLSearchParams({ limit: "100" });
      if (before) params.set("before", before);

      const messages = (await rest.get(Routes.channelMessages(config.manifestChannelId), {
        query: params,
      })) as Array<{ id: string; attachments: Array<{ url: string; filename: string }> }>;

      if (messages.length === 0) break;

      for (const msg of messages) {
        for (const att of msg.attachments) {
          if (att.filename.endsWith(".manifest.json")) {
            try {
              const res = await fetch(att.url);
              if (res.ok) {
                const raw = await res.json();
                manifests.push(parseManifest(raw));
              }
            } catch {
              // skip malformed manifests
            }
          }
        }
      }

      before = messages[messages.length - 1]?.id;
    }

    // Sort newest first
    manifests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    cache = { manifests, at: Date.now() };
    return NextResponse.json({ files: manifests });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch files" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  cache = null;
  return NextResponse.json({ ok: true });
}
