import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { avatarUrl } from "@/lib/discord-oauth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return NextResponse.json({ authenticated: false }, { status: 401 });

  return NextResponse.json({
    authenticated: true,
    userId: ctx.userId,
    username: ctx.username,
    avatarUrl: avatarUrl(ctx.userId, null), // simplified — avatar stored separately if needed
    hasBotConfig: ctx.botConfig !== null,
  });
}
