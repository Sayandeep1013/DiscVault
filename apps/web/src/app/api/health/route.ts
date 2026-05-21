export const dynamic = "force-dynamic";

export function GET() {
  return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
    headers: { "Content-Type": "application/json" },
  });
}
