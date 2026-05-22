import { getAllBotConfigs } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const ts = Date.now();
  let dbOk = false;

  // Ping the DB so Neon never auto-suspends between UptimeRobot pings.
  // Without this, Neon sleeps after 5 min idle even while Render stays up,
  // causing the first files request after idle to fail with a DB connection error.
  try {
    // getAllBotConfigs with a dummy userId runs a quick SELECT — enough to keep Neon awake
    await getAllBotConfigs("__health_ping__");
    dbOk = true;
  } catch {
    dbOk = false;
  }

  return new Response(
    JSON.stringify({ ok: true, ts, db: dbOk }),
    { headers: { "Content-Type": "application/json" } }
  );
}
