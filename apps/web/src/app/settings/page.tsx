"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface ConfigDisplay {
  configured: boolean;
  guildId?: string;
  vaultChannelIds?: string[];
  manifestChannelId?: string;
  botTokenMasked?: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const [config, setConfig] = useState<ConfigDisplay | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [importCode, setImportCode] = useState("");
  const [importStatus, setImportStatus] = useState<"idle" | "ok" | "error">("idle");
  const [importError, setImportError] = useState("");
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [loadingInvite, setLoadingInvite] = useState(false);

  useEffect(() => {
    // Auth gate
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d: { authenticated?: boolean }) => { if (!d.authenticated) router.replace("/login"); })
      .catch(() => router.replace("/login"));

    fetch("/api/user/bot-config")
      .then((r) => r.json())
      .then((d) => setConfig(d as ConfigDisplay))
      .catch(() => setConfig({ configured: false }));
  }, [router]);

  const generateInvite = async () => {
    setLoadingInvite(true);
    try {
      const res = await fetch("/api/invite");
      const data = await res.json() as { code?: string; error?: string };
      if (data.code) setInviteCode(data.code);
    } finally {
      setLoadingInvite(false);
    }
  };

  const copyInvite = async () => {
    if (!inviteCode) return;
    await navigator.clipboard.writeText(inviteCode);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2000);
  };

  const joinWithCode = async () => {
    if (!importCode.trim()) return;
    setImportStatus("idle");
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteCode: importCode.trim() }),
    });
    const data = await res.json() as { ok?: boolean; error?: string };
    if (data.ok) {
      setImportStatus("ok");
      setImportCode("");
      const cfg = await fetch("/api/config").then((r) => r.json()) as ConfigDisplay;
      setConfig(cfg);
    } else {
      setImportStatus("error");
      setImportError(data.error ?? "Unknown error");
    }
  };

  return (
    <div className="min-h-screen relative z-10">
      {/* Navbar */}
      <nav className="border-b border-blueprint-border bg-blueprint-navy px-6 py-3 flex items-center gap-4">
        <Link href="/" className="text-blueprint-muted text-xs hover:text-blueprint-cyan transition-colors">
          ← Back to Vault
        </Link>
        <span className="text-blueprint-border">|</span>
        <span className="text-blueprint-cyan text-xs uppercase tracking-widest font-bold">// Settings</span>
      </nav>

      <main className="px-6 py-8 max-w-2xl mx-auto flex flex-col gap-6">

        {/* Current Config */}
        <section className="blueprint-panel p-5">
          <div className="text-blueprint-cyan text-xs uppercase tracking-widest font-bold mb-4 pb-2 border-b border-blueprint-border">
            Current Configuration
          </div>
          {config?.configured ? (
            <div className="flex flex-col gap-2 text-xs font-mono">
              <Row label="STATUS" value="CONNECTED" highlight />
              <Row label="BOT_TOKEN" value={config.botTokenMasked ?? ""} />
              <Row label="GUILD_ID" value={config.guildId ?? ""} />
              <Row label="VAULT_CHANNELS" value={(config.vaultChannelIds ?? []).join(", ")} />
              <Row label="MANIFEST_CH" value={config.manifestChannelId ?? ""} />
            </div>
          ) : (
            <div className="text-blueprint-muted text-xs">Not configured. Use an invite code below to connect.</div>
          )}
        </section>

        {/* Invite Code — Generate */}
        {config?.configured && (
          <section className="blueprint-panel p-5">
            <div className="text-blueprint-cyan text-xs uppercase tracking-widest font-bold mb-4 pb-2 border-b border-blueprint-border">
              Share Invite Code
            </div>
            <p className="text-blueprint-muted text-xs mb-4">
              Send this to friends. They paste it below to connect instantly — no Discord Developer Portal needed.
            </p>
            <button
              onClick={generateInvite}
              disabled={loadingInvite}
              className="px-4 py-2 border border-blueprint-cyan text-blueprint-cyan text-xs uppercase tracking-widest hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors disabled:opacity-50"
            >
              {loadingInvite ? "Generating..." : "Generate Invite Code"}
            </button>

            {inviteCode && (
              <div className="mt-4 flex flex-col gap-2">
                <div className="bg-blueprint-bg border border-blueprint-cyanFaint px-3 py-2 text-xs text-blueprint-cyan font-mono break-all">
                  {inviteCode}
                </div>
                <button
                  onClick={copyInvite}
                  className="self-start text-xs border border-blueprint-border text-blueprint-muted px-3 py-1.5 hover:border-blueprint-cyan hover:text-blueprint-cyan transition-colors"
                >
                  {copiedInvite ? "✓ Copied!" : "⎘ Copy"}
                </button>
              </div>
            )}
          </section>
        )}

        {/* Invite Code — Join */}
        <section className="blueprint-panel p-5">
          <div className="text-blueprint-cyan text-xs uppercase tracking-widest font-bold mb-4 pb-2 border-b border-blueprint-border">
            Join with Invite Code
          </div>
          <p className="text-blueprint-muted text-xs mb-4">
            Paste a code from a friend to connect to their vault.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="DISCVAULT:eyJ..."
              value={importCode}
              onChange={(e) => { setImportCode(e.target.value); setImportStatus("idle"); }}
              className="flex-1 bg-blueprint-bg border border-blueprint-border text-blueprint-cyanDim text-xs px-3 py-2 outline-none focus:border-blueprint-cyan placeholder:text-blueprint-muted font-mono"
            />
            <button
              onClick={joinWithCode}
              disabled={!importCode.trim()}
              className="px-4 py-2 border border-blueprint-cyan text-blueprint-cyan text-xs uppercase tracking-widest hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors disabled:opacity-40"
            >
              Join
            </button>
          </div>
          {importStatus === "ok" && (
            <div className="mt-2 text-xs text-blueprint-cyan">✓ Connected successfully. <Link href="/" className="underline">Go to vault →</Link></div>
          )}
          {importStatus === "error" && (
            <div className="mt-2 text-xs text-red-400">✗ {importError}</div>
          )}
        </section>

        {/* Footer note */}
        <p className="text-blueprint-muted text-xs text-center">
          Config stored at ~/.discvault/config.json
        </p>
      </main>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex gap-3">
      <span className="text-blueprint-muted w-32 shrink-0">{label}</span>
      <span className={highlight ? "text-blueprint-cyan" : "text-blueprint-cyanDim"}>{value}</span>
    </div>
  );
}
