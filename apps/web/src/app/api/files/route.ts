import { NextRequest, NextResponse } from "next/server";
import { resolveConfig } from "@/lib/config-resolver";
import { createDiscordClient } from "@discvault/discord-adapter";
import { parseManifest } from "@discvault/core";
import type { Manifest } from "@discvault/core";
import { Routes } from "discord-api-types/v10";

// Cache keyed by manifestChannelId so different servers never pollute each other
const channelCache = new Map<string, { manifests: Manifest[]; at: number }>();
const CACHE_TTL_MS = 60_000;

export async function GET(req: NextRequest) {
  const resolved = await resolveConfig(req);
  if (!resolved) {
    return NextResponse.json({ error: "Not configured — sign in and complete setup first." }, { status: 404 });
  }
  const { config } = resolved;
  const cacheKey = config.manifestChannelId;

  const hit = channelCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ files: hit.manifests, cached: true });
  }

  const rest = createDiscordClient({ botToken: config.botToken });
  const manifests: Manifest[] = [];
  let messagesScanned = 0;
  let parseErrors = 0;
  let fetchErrors = 0;

  try {
    let before: string | undefined;

    for (let page = 0; page < 50; page++) {
      const params = new URLSearchParams({ limit: "100" });
      if (before) params.set("before", before);

      let messages: Array<{ id: string; attachments: Array<{ url: string; filename: string }> }>;
      try {
        messages = (await rest.get(Routes.channelMessages(config.manifestChannelId), {
          query: params,
        })) as typeof messages;
      } catch (err) {
        const status = (err as Record<string, unknown>)["status"];
        console.error(`[files] channel read failed (status ${status}):`, err);
        if (status === 403) {
          return NextResponse.json({
            error: "Bot cannot read the manifests channel. Make sure the bot has 'Read Message History' permission on that channel.",
            files: [],
          }, { status: 403 });
        }
        throw err;
      }

      if (messages.length === 0) break;
      messagesScanned += messages.length;

      for (const msg of messages) {
        for (const att of msg.attachments) {
          if (!att.filename.endsWith(".manifest.json")) continue;

          try {
            // 8-second timeout per CDN fetch — prevents one slow URL blocking the whole scan
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8_000);
            const res = await fetch(att.url, { signal: controller.signal });
            clearTimeout(timeout);

            if (!res.ok) {
              console.error(`[files] CDN fetch failed for ${att.filename}: HTTP ${res.status}`);
              fetchErrors++;
              continue;
            }

            const raw = await res.json();
            manifests.push(parseManifest(raw));
          } catch (err) {
            console.error(`[files] failed to load manifest ${att.filename}:`, err);
            if ((err as Error).name === "AbortError") {
              fetchErrors++;
            } else {
              parseErrors++;
            }
          }
        }
      }

      before = messages[messages.length - 1]?.id;
    }

    manifests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    channelCache.set(cacheKey, { manifests, at: Date.now() });

    console.log(`[files] scan complete: ${messagesScanned} messages, ${manifests.length} manifests, ${parseErrors} parse errors, ${fetchErrors} fetch errors`);

    return NextResponse.json({
      files: manifests,
      _scan: { messagesScanned, manifestsFound: manifests.length, parseErrors, fetchErrors },
    });
  } catch (err) {
    console.error("[files] scan error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to scan manifests channel", files: [] },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  // Bust cache for this user's channel only, or all if admin
  const resolved = await resolveConfig(req);
  if (resolved) {
    channelCache.delete(resolved.config.manifestChannelId);
  } else {
    channelCache.clear();
  }
  return NextResponse.json({ ok: true });
}
