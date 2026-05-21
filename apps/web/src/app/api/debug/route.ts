import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { getBotConfig, getDecryptedBotToken } from "@/lib/db";
import { createDiscordClient } from "@discvault/discord-adapter";
import { Routes } from "discord-api-types/v10";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const result: Record<string, unknown> = {};

  // 1. Auth check
  try {
    const ctx = await getAuthContext(req);
    result["auth"] = ctx
      ? { ok: true, userId: ctx.userId, username: ctx.username, hasBotConfig: ctx.botConfig !== null }
      : { ok: false, reason: "No valid session cookie" };
  } catch (err) {
    result["auth"] = { ok: false, error: String(err) };
  }

  // 2. Bot config check
  let botToken: string | null = null;
  let manifestChannelId: string | null = null;
  try {
    const ctx = await getAuthContext(req);
    if (ctx) {
      const cfg = await getBotConfig(ctx.userId);
      if (cfg) {
        manifestChannelId = cfg.manifestChannelId;
        botToken = await getDecryptedBotToken(ctx.userId);
        result["botConfig"] = {
          ok: true,
          guildId: cfg.guildId,
          vaultChannels: cfg.vaultChannelIds.length,
          manifestChannelId: cfg.manifestChannelId,
          tokenDecrypted: !!botToken,
        };
      } else {
        result["botConfig"] = { ok: false, reason: "No bot config saved for this user" };
      }
    } else {
      result["botConfig"] = { ok: false, reason: "Not authenticated" };
    }
  } catch (err) {
    result["botConfig"] = { ok: false, error: String(err) };
  }

  // 3. Discord bot connection
  if (botToken) {
    try {
      const rest = createDiscordClient({ botToken });
      const me = await rest.get(Routes.user("@me")) as { username: string; id: string };
      result["discordBot"] = { ok: true, username: me.username, id: me.id };
    } catch (err) {
      result["discordBot"] = { ok: false, error: String(err) };
    }
  } else {
    result["discordBot"] = { ok: false, reason: "No bot token available" };
  }

  // 4. Manifests channel access
  if (botToken && manifestChannelId) {
    try {
      const rest = createDiscordClient({ botToken });
      const ch = await rest.get(Routes.channel(manifestChannelId)) as { name: string };
      result["manifestChannel"] = { ok: true, name: ch.name, canView: true };

      // Try reading messages
      try {
        const msgs = await rest.get(Routes.channelMessages(manifestChannelId), {
          query: new URLSearchParams({ limit: "10" }),
        }) as Array<{ id: string; attachments: Array<{ filename: string }> }>;

        const manifests = msgs.flatMap(m => m.attachments.filter(a => a.filename.endsWith(".manifest.json")));
        result["manifestChannel"] = {
          ...result["manifestChannel"] as object,
          canReadHistory: true,
          recentMessages: msgs.length,
          manifestFilesFound: manifests.length,
          manifestNames: manifests.slice(0, 5).map(a => a.filename),
        };
      } catch (err) {
        result["manifestChannel"] = {
          ...result["manifestChannel"] as object,
          canReadHistory: false,
          readError: String(err),
          fix: "Bot is missing Read Message History on the manifests channel",
        };
      }
    } catch (err) {
      result["manifestChannel"] = {
        ok: false,
        error: String(err),
        fix: "Bot cannot access the manifests channel — check permissions",
      };
    }
  }

  return NextResponse.json(result, { status: 200 });
}
