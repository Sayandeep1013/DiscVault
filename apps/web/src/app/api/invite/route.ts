import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { encodeInvite } from "@/lib/invite";

export async function GET() {
  const config = await loadConfig();
  if (!config) return NextResponse.json({ error: "Not configured" }, { status: 404 });
  return NextResponse.json({ code: encodeInvite(config) });
}
