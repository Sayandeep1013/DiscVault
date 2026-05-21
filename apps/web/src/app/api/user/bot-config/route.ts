import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { saveBotConfig, getBotConfig } from "@/lib/db";
import { encryptToken } from "@/lib/crypto";
import { createDiscordClient } from "@discvault/discord-adapter";
import { Routes } from "discord-api-types/v10";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await requireAuth(req).catch(() => null);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cfg = await getBotConfig(ctx.userId);
  if (!cfg) return NextResponse.json({ configured: false });

  return NextResponse.json({
    configured: true,
    guildId: cfg.guildId,
    vaultChannelIds: cfg.vaultChannelIds,
    manifestChannelId: cfg.manifestChannelId,
  });
}

export async function POST(req: NextRequest) {
  const ctx = await requireAuth(req).catch(() => null);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as Record<string, unknown>;
  const { botToken, guildId, vaultChannelIds, manifestChannelId } = body;

  if (
    typeof botToken !== "string" || !botToken.trim() ||
    typeof guildId !== "string" || !guildId.trim() ||
    !Array.isArray(vaultChannelIds) || vaultChannelIds.length === 0 ||
    typeof manifestChannelId !== "string" || !manifestChannelId.trim()
  ) {
    return NextResponse.json({ error: "All fields are required" }, { status: 400 });
  }

  const rest = createDiscordClient({ botToken });

  // Validate bot token
  try {
    await rest.get(Routes.user("@me"));
  } catch {
    return NextResponse.json(
      { error: "Bot token is invalid. Go to Discord Developer Portal → Bot → Reset Token and copy the new one." },
      { status: 400 }
    );
  }

  // Validate manifest channel — check both VIEW and READ_MESSAGE_HISTORY
  try {
    await rest.get(Routes.channel(manifestChannelId));
    await rest.get(Routes.channelMessages(manifestChannelId), {
      query: new URLSearchParams({ limit: "1" }),
    });
  } catch (err: unknown) {
    const status = (err as Record<string, unknown>)["status"];
    if (status === 403) {
      return NextResponse.json(
        {
          error:
            "Bot cannot access the manifests channel (Missing Access). " +
            "Make sure: (1) you invited your bot to the server using the invite link in Step 2, " +
            "(2) the bot has View Channel and Read Message History permissions on that channel.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: `Manifests channel ID ${manifestChannelId} not found. Double-check you copied the right channel ID.` },
      { status: 400 }
    );
  }

  // Validate vault channels
  for (const chId of vaultChannelIds as string[]) {
    try {
      await rest.get(Routes.channel(chId));
    } catch {
      return NextResponse.json(
        {
          error:
            `Bot cannot access vault channel ${chId}. ` +
            "Make sure the bot is in your server and has Send Messages + Attach Files permissions.",
        },
        { status: 400 }
      );
    }
  }

  try {
    await saveBotConfig(
      ctx.userId,
      encryptToken(botToken),
      guildId,
      vaultChannelIds as string[],
      manifestChannelId
    );
  } catch (err) {
    console.error("saveBotConfig failed:", err);
    return NextResponse.json(
      { error: "Database error saving config. Please try again in a moment." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
