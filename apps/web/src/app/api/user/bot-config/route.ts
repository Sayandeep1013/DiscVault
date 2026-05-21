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
    typeof botToken !== "string" ||
    typeof guildId !== "string" ||
    !Array.isArray(vaultChannelIds) ||
    typeof manifestChannelId !== "string"
  ) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Validate the token works and has channel access
  try {
    const rest = createDiscordClient({ botToken });
    await rest.get(Routes.channel(manifestChannelId));
  } catch {
    return NextResponse.json(
      { error: "Bot token or channel ID is invalid. Make sure the bot is in your server." },
      { status: 400 }
    );
  }

  await saveBotConfig(ctx.userId, encryptToken(botToken), guildId, vaultChannelIds as string[], manifestChannelId);
  return NextResponse.json({ ok: true });
}
