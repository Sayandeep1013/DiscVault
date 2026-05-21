import { NextRequest, NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";
import { decodeInvite } from "@/lib/invite";

export async function GET() {
  const config = await loadConfig();
  if (!config) return NextResponse.json({ configured: false }, { status: 404 });

  // Mask the bot token for display
  return NextResponse.json({
    configured: true,
    guildId: config.guildId,
    vaultChannelIds: config.vaultChannelIds,
    manifestChannelId: config.manifestChannelId,
    botTokenMasked: config.botToken.slice(0, 10) + "••••••••••••••••••",
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>;

  // Invite code import
  if (typeof body["inviteCode"] === "string") {
    try {
      const config = decodeInvite(body["inviteCode"]);
      await saveConfig(config);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid invite code" },
        { status: 400 }
      );
    }
  }

  // Direct config save
  const { botToken, guildId, vaultChannelIds, manifestChannelId } = body as Record<string, unknown>;
  if (
    typeof botToken !== "string" ||
    typeof guildId !== "string" ||
    !Array.isArray(vaultChannelIds) ||
    typeof manifestChannelId !== "string"
  ) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  await saveConfig({ botToken, guildId, vaultChannelIds: vaultChannelIds as string[], manifestChannelId });
  return NextResponse.json({ ok: true });
}
