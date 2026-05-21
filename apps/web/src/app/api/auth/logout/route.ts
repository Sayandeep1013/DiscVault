import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookieHeader } from "@/lib/auth";
import { deleteSession } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get("dv_session");
  if (cookie) await deleteSession(cookie.value);
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", clearSessionCookieHeader());
  return res;
}
