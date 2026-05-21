import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, getDiscordUser } from "@/lib/discord-oauth";
import { parseState, generateSessionToken } from "@/lib/auth";
import { upsertUser, createSession, getBotConfig } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const storedState = req.cookies.get("dv_oauth_state")?.value;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (!code || !stateParam) return NextResponse.redirect(`${appUrl}/login?error=missing_params`);
  if (!storedState || stateParam !== storedState) return NextResponse.redirect(`${appUrl}/login?error=invalid_state`);

  let cliPort: number | undefined;
  try {
    const parsed = parseState(stateParam);
    if (typeof parsed["cliPort"] === "number") cliPort = parsed["cliPort"];
  } catch {
    return NextResponse.redirect(`${appUrl}/login?error=invalid_state`);
  }

  try {
    const accessToken = await exchangeCode(code);
    const discordUser = await getDiscordUser(accessToken);

    await upsertUser(discordUser.id, discordUser.username, discordUser.avatar);

    const sessionToken = generateSessionToken();
    const source = cliPort ? "cli" : "web";
    await createSession(sessionToken, discordUser.id, source);

    const botConfig = await getBotConfig(discordUser.id);
    const isFirstLogin = !botConfig;

    if (cliPort) {
      try {
        await fetch(`http://localhost:${cliPort}/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: sessionToken, username: discordUser.username }),
        });
      } catch { /* CLI server may already be closed */ }

      const res = NextResponse.redirect(`${appUrl}/auth/cli-success`);
      res.cookies.delete("dv_oauth_state");
      return res;
    }

    // Web flow — 200 + JS redirect so cookie is stored before navigation
    const redirectTo = isFirstLogin ? `${appUrl}/setup` : `${appUrl}/`;
    const html = `<!DOCTYPE html><html><head><title>Signing in...</title></head><body>
<script>window.location.replace(${JSON.stringify(redirectTo)});</script>
</body></html>`;
    const res = new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html" } });
    res.cookies.set("dv_session", sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 604800,
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
    res.cookies.delete("dv_oauth_state");
    return res;
  } catch (err) {
    console.error("Auth callback error:", err);
    return NextResponse.redirect(`${appUrl}/login?error=auth_failed`);
  }
}
