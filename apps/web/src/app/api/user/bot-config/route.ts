import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { saveBotConfig, getAllBotConfigs, removeBotConfig } from "@/lib/db";
import { encryptToken } from "@/lib/crypto";
import { createDiscordClient } from "@discvault/discord-adapter";
import { Routes } from "discord-api-types/v10";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await requireAuth(req).catch(() => null);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const configs = await getAllBotConfigs(ctx.userId);
  return NextResponse.json({
    configured: configs.length > 0,
    servers: configs.map((c) => ({
      guildId: c.guildId,
      guildName: c.guildName,
      botUsername: c.botUsername,
      vaultChannelIds: c.vaultChannelIds,
      manifestChannelId: c.manifestChannelId,
    })),
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

  // 1. Validate bot token + get bot username
  let botUsername = "";
  try {
    const me = await rest.get(Routes.user("@me")) as { username: string };
    botUsername = me.username;
  } catch {
    return NextResponse.json(
      { error: "Bot token is invalid. In Discord Developer Portal → your app → Bot tab → Reset Token → copy the new token." },
      { status: 400 }
    );
  }

  // 2. Get guild name
  let guildName = guildId;
  try {
    const guild = await rest.get(Routes.guild(guildId)) as { name: string };
    guildName = guild.name;
  } catch {
    // If bot doesn't have guild info, just use the ID
  }

  // 3. Validate manifests channel (read access)
  try {
    await rest.get(Routes.channel(manifestChannelId));
    await rest.get(Routes.channelMessages(manifestChannelId), {
      query: new URLSearchParams({ limit: "1" }),
    });
  } catch (err: unknown) {
    const status = (err as Record<string, unknown>)["status"];
    if (status === 403) {
      return NextResponse.json({
        error: `Bot @${botUsername} cannot read the manifests channel.\n\nIn Discord: right-click the manifests channel → Edit Channel → Permissions → find your bot's role → enable: ✓ View Channel, ✓ Read Message History, ✓ Send Messages, ✓ Attach Files.`,
      }, { status: 400 });
    }
    return NextResponse.json({ error: `Manifests channel ID not found.` }, { status: 400 });
  }

  // 4. Validate vault channels (write access via test upload + delete)
  for (const chId of vaultChannelIds as string[]) {
    try {
      const testMsg = await rest.post(Routes.channelMessages(chId), {
        files: [{ data: Buffer.from("discvault-permission-test"), name: "test.bin", contentType: "application/octet-stream" }],
        body: { attachments: [{ id: "0", filename: "test.bin" }] },
      }) as { id: string };
      await rest.delete(Routes.channelMessage(chId, testMsg.id));
    } catch (err: unknown) {
      const status = (err as Record<string, unknown>)["status"];
      if (status === 403) {
        return NextResponse.json({
          error: `Bot @${botUsername} cannot upload files to vault channel ${chId}.\n\nIn Discord: right-click that channel → Edit Channel → Permissions → enable: ✓ View Channel, ✓ Send Messages, ✓ Attach Files.`,
        }, { status: 400 });
      }
      return NextResponse.json({ error: `Vault channel ${chId} not found.` }, { status: 400 });
    }
  }

  try {
    await saveBotConfig(
      ctx.userId,
      encryptToken(botToken),
      guildId,
      vaultChannelIds as string[],
      manifestChannelId,
      guildName,
      botUsername
    );
  } catch (err) {
    console.error("saveBotConfig failed:", err);
    return NextResponse.json({ error: "Database error. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, botUsername, guildName });
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireAuth(req).catch(() => null);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const guildId = searchParams.get("guildId");
  if (!guildId) return NextResponse.json({ error: "Missing guildId" }, { status: 400 });

  await removeBotConfig(ctx.userId, guildId);
  return NextResponse.json({ ok: true });
}
