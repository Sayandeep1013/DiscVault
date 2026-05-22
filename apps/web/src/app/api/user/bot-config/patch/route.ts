import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { saveBotConfig, getBotConfig, getDecryptedBotToken } from "@/lib/db";
import { createDiscordClient } from "@discvault/discord-adapter";
import { Routes } from "discord-api-types/v10";

export const dynamic = "force-dynamic";

// Updates channel IDs only — bot token stays encrypted in DB, no need to re-enter it
export async function POST(req: NextRequest) {
  const ctx = await requireAuth(req).catch(() => null);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as Record<string, unknown>;
  const { vaultChannelIds, manifestChannelId, guildId } = body;

  if (
    !Array.isArray(vaultChannelIds) || vaultChannelIds.length === 0 ||
    typeof manifestChannelId !== "string" || !manifestChannelId.trim()
  ) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Get existing config so we can keep the bot token
  const existing = await getBotConfig(ctx.userId);
  if (!existing) return NextResponse.json({ error: "No bot config found. Complete setup first." }, { status: 404 });

  const botToken = await getDecryptedBotToken(ctx.userId);
  if (!botToken) return NextResponse.json({ error: "Could not decrypt bot token" }, { status: 500 });

  const rest = createDiscordClient({ botToken });

  // Validate manifest channel (read access)
  try {
    await rest.get(Routes.channel(manifestChannelId));
    await rest.get(Routes.channelMessages(manifestChannelId), {
      query: new URLSearchParams({ limit: "1" }),
    });
  } catch (err: unknown) {
    const status = (err as Record<string, unknown>)["status"];
    if (status === 404) return NextResponse.json({ error: `Manifest channel ${manifestChannelId} not found.` }, { status: 400 });
    if (status === 403) return NextResponse.json({ error: `Bot cannot read manifest channel ${manifestChannelId}. Check Read Message History permission.` }, { status: 400 });
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }

  // Validate vault channels (write access)
  for (const chId of vaultChannelIds as string[]) {
    try {
      await rest.get(Routes.channel(chId));
    } catch {
      return NextResponse.json({ error: `Vault channel ${chId} not found or inaccessible.` }, { status: 400 });
    }
  }

  // Re-encrypt token (same token, just re-saving with new channels)
  const { encryptToken } = await import("@/lib/crypto");
  const encrypted = encryptToken(botToken);
  await saveBotConfig(
    ctx.userId,
    encrypted,
    typeof guildId === "string" && guildId.trim() ? guildId : existing.guildId,
    vaultChannelIds as string[],
    manifestChannelId
  );

  return NextResponse.json({ ok: true });
}
