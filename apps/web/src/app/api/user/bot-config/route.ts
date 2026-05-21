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

  // 1. Validate bot token
  let botUser: { username: string } | null = null;
  try {
    botUser = await rest.get(Routes.user("@me")) as { username: string };
  } catch {
    return NextResponse.json(
      { error: "Bot token is invalid. In Discord Developer Portal → your app → Bot tab → Reset Token → copy the new token." },
      { status: 400 }
    );
  }

  // 2. Validate manifests channel — read access
  try {
    await rest.get(Routes.channel(manifestChannelId));
    await rest.get(Routes.channelMessages(manifestChannelId), {
      query: new URLSearchParams({ limit: "1" }),
    });
  } catch (err: unknown) {
    const status = (err as Record<string, unknown>)["status"];
    if (status === 403) {
      return NextResponse.json({
        error: `Bot @${botUser?.username ?? "bot"} cannot read the manifests channel.\n\nIn Discord: right-click the manifests channel → Edit Channel → Permissions → find your bot's role → enable: ✓ View Channel, ✓ Read Message History, ✓ Send Messages, ✓ Attach Files.`,
      }, { status: 400 });
    }
    return NextResponse.json({ error: `Manifests channel ID not found. Re-copy the ID: right-click channel → Copy Channel ID (requires Developer Mode in Discord Settings → Advanced).` }, { status: 400 });
  }

  // 3. Validate vault channels — write access (try sending + deleting a test message)
  for (const chId of vaultChannelIds as string[]) {
    try {
      // Test that the bot can actually upload a file attachment (not just view the channel)
      const testMsg = await rest.post(Routes.channelMessages(chId), {
        files: [{ data: Buffer.from("discvault-permission-test"), name: "test.bin", contentType: "application/octet-stream" }],
        body: { attachments: [{ id: "0", filename: "test.bin" }] },
      }) as { id: string };
      // Clean up immediately
      await rest.delete(Routes.channelMessage(chId, testMsg.id));
    } catch (err: unknown) {
      const status = (err as Record<string, unknown>)["status"];
      if (status === 403) {
        return NextResponse.json({
          error: `Bot @${botUser?.username ?? "bot"} cannot upload files to vault channel ${chId}.\n\nIn Discord: right-click that channel → Edit Channel → Permissions → find your bot's role → enable: ✓ View Channel, ✓ Send Messages, ✓ Attach Files.`,
        }, { status: 400 });
      }
      return NextResponse.json({ error: `Vault channel ${chId} not found. Re-copy the channel ID.` }, { status: 400 });
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
    return NextResponse.json({ error: "Database error. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, botUsername: botUser?.username });
}
