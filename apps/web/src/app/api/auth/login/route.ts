import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/discord-oauth";
import { generateState } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cliPort = req.nextUrl.searchParams.get("cli_port");
  const state = generateState(cliPort ? { cliPort: Number(cliPort) } : {});
  const authUrl = buildAuthUrl(state);

  const res = NextResponse.redirect(authUrl);
  // Store state in a short-lived cookie for CSRF validation
  res.cookies.set("dv_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 300, // 5 minutes
    path: "/",
  });
  return res;
}
