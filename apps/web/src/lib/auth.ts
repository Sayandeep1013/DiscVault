import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { getUserBySession, getBotConfig, type BotConfig } from "./db";

export interface AuthContext {
  userId: string;
  username: string;
  botConfig: BotConfig | null;
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function generateState(extra?: Record<string, unknown>): string {
  const csrf = randomBytes(16).toString("hex");
  return Buffer.from(JSON.stringify({ csrf, ...extra })).toString("base64url");
}

export function parseState(state: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(state, "base64url").toString("utf-8")) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid state parameter");
  }
}

export async function getAuthContext(req: NextRequest): Promise<AuthContext | null> {
  // 1. Bearer token (CLI)
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const row = await getUserBySession(token);
    if (row) {
      const botConfig = await getBotConfig(row.user_id);
      return { userId: row.user_id, username: row.username, botConfig };
    }
  }

  // 2. Session cookie (web)
  const cookie = req.cookies.get("dv_session");
  if (cookie) {
    const row = await getUserBySession(cookie.value);
    if (row) {
      const botConfig = await getBotConfig(row.user_id);
      return { userId: row.user_id, username: row.username, botConfig };
    }
  }

  return null;
}

export async function requireAuth(req: NextRequest): Promise<AuthContext> {
  const ctx = await getAuthContext(req);
  if (!ctx) throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  return ctx;
}

export function sessionCookieHeader(token: string, maxAgeSec = 604800): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `dv_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`;
}

export function clearSessionCookieHeader(): string {
  return "dv_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}
