import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { getAllBotConfigs, botConfigToDiscVaultConfig, type BotConfig } from "@/lib/db";
import { createDiscordClient } from "@discvault/discord-adapter";
import { parseManifest } from "@discvault/core";
import type { Manifest } from "@discvault/core";
import { Routes } from "discord-api-types/v10";

export interface ManifestWithServer extends Manifest {
  _serverName: string;
  _guildId: string;
}

// Cache per manifests channel ID
const channelCache = new Map<string, { manifests: ManifestWithServer[]; at: number }>();
const CACHE_TTL_MS = 60_000;

async function scanChannel(
  botConfig: BotConfig,
  guildName: string
): Promise<{ manifests: ManifestWithServer[]; messagesScanned: number; errors: number }> {
  const dvConfig = await botConfigToDiscVaultConfig(botConfig);
  const rest = createDiscordClient({ botToken: dvConfig.botToken });
  const manifests: ManifestWithServer[] = [];
  let messagesScanned = 0;
  let errors = 0;

  let before: string | undefined;
  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({ limit: "100" });
    if (before) params.set("before", before);

    let messages: Array<{ id: string; attachments: Array<{ url: string; filename: string }> }>;
    try {
      messages = (await rest.get(Routes.channelMessages(botConfig.manifestChannelId), {
        query: params,
      })) as typeof messages;
    } catch (err) {
      const status = (err as Record<string, unknown>)["status"];
      console.error(`[files] channel ${botConfig.manifestChannelId} (${guildName}) read failed (${status}):`, err);
      break;
    }

    if (messages.length === 0) break;
    messagesScanned += messages.length;

    for (const msg of messages) {
      for (const att of msg.attachments) {
        if (!att.filename.endsWith(".manifest.json")) continue;
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8_000);
          const res = await fetch(att.url, { signal: controller.signal });
          clearTimeout(timeout);
          if (!res.ok) { errors++; continue; }
          const raw = await res.json();
          const m = parseManifest(raw) as ManifestWithServer;
          m._serverName = guildName;
          m._guildId = botConfig.guildId;
          manifests.push(m);
        } catch {
          errors++;
        }
      }
    }
    before = messages[messages.length - 1]?.id;
  }

  console.log(`[files] scan on channel ${botConfig.manifestChannelId} (${guildName}): ${messagesScanned} messages, ${manifests.length} manifests, ${errors} errors`);
  return { manifests, messagesScanned, errors };
}

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const allConfigs = await getAllBotConfigs(ctx.userId);
  if (allConfigs.length === 0) {
    return NextResponse.json({ error: "Not configured — complete setup first." }, { status: 404 });
  }

  const allManifests: ManifestWithServer[] = [];
  let totalMessages = 0;
  let totalErrors = 0;

  for (const cfg of allConfigs) {
    const guildName = cfg.guildName || cfg.guildId;
    const cacheKey = cfg.manifestChannelId;
    const hit = channelCache.get(cacheKey);

    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      allManifests.push(...hit.manifests);
      continue;
    }

    try {
      const { manifests, messagesScanned, errors } = await scanChannel(cfg, guildName);
      channelCache.set(cacheKey, { manifests, at: Date.now() });
      allManifests.push(...manifests);
      totalMessages += messagesScanned;
      totalErrors += errors;
    } catch (err) {
      console.error(`[files] scan failed for ${guildName}:`, err);
      totalErrors++;
    }
  }

  // Deduplicate by fileId (same file might appear in multiple servers somehow)
  const seen = new Set<string>();
  const deduped = allManifests.filter((m) => {
    if (seen.has(m.fileId)) return false;
    seen.add(m.fileId);
    return true;
  });

  deduped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({
    files: deduped,
    _scan: { messagesScanned: totalMessages, manifestsFound: deduped.length, errors: totalErrors, servers: allConfigs.length },
  });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (ctx) {
    const configs = await getAllBotConfigs(ctx.userId);
    for (const cfg of configs) channelCache.delete(cfg.manifestChannelId);
  } else {
    channelCache.clear();
  }
  return NextResponse.json({ ok: true });
}
