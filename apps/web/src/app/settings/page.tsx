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

  // Channel editing state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ vaultChannelIds: "", manifestChannelId: "", guildId: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editOk, setEditOk] = useState(false);

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
    const data = await res.json() as { ok?: boolean; serverConfig?: { guildId: string; vaultChannelIds: string[]; manifestChannelId: string }; error?: string };
    if (data.ok && data.serverConfig) {
      // Invite code gives channel IDs only — redirect to setup so user provides their own bot token
      const params = new URLSearchParams({
        guildId: data.serverConfig.guildId,
        vaultChannelIds: data.serverConfig.vaultChannelIds.join(","),
        manifestChannelId: data.serverConfig.manifestChannelId,
      });
      window.location.href = `/setup?${params}`;
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
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-blueprint-border">
            <div className="text-blueprint-cyan text-xs uppercase tracking-widest font-bold">Current Configuration</div>
            {config?.configured && !editing && (
              <button
                onClick={() => {
                  setEditForm({
                    guildId: config.guildId ?? "",
                    vaultChannelIds: (config.vaultChannelIds ?? []).join(", "),
                    manifestChannelId: config.manifestChannelId ?? "",
                  });
                  setEditError(null);
                  setEditOk(false);
                  setEditing(true);
                }}
                className="text-xs border border-blueprint-border text-blueprint-muted px-3 py-1 hover:border-blueprint-cyan hover:text-blueprint-cyan transition-colors"
              >
                ✎ Edit Channels
              </button>
            )}
          </div>

          {config?.configured && !editing && (
            <div className="flex flex-col gap-2 text-xs font-mono">
              <Row label="STATUS" value="CONNECTED" highlight />
              <Row label="BOT_TOKEN" value={config.botTokenMasked ?? ""} />
              <Row label="GUILD_ID" value={config.guildId ?? ""} />
              <Row label="VAULT_CHANNELS" value={(config.vaultChannelIds ?? []).join(", ")} />
              <Row label="MANIFEST_CH" value={config.manifestChannelId ?? ""} />
            </div>
          )}

          {config?.configured && editing && (
            <div className="flex flex-col gap-4">
              <p className="text-blueprint-muted text-xs">
                Update channel IDs without re-entering your bot token. Use this to fix mismatched channels.
              </p>
              <EditField
                label="GUILD_ID"
                value={editForm.guildId}
                onChange={(v) => setEditForm((f) => ({ ...f, guildId: v }))}
              />
              <EditField
                label="VAULT_CHANNEL_IDS (comma-separated)"
                value={editForm.vaultChannelIds}
                onChange={(v) => setEditForm((f) => ({ ...f, vaultChannelIds: v }))}
              />
              <EditField
                label="MANIFEST_CHANNEL_ID"
                value={editForm.manifestChannelId}
                onChange={(v) => setEditForm((f) => ({ ...f, manifestChannelId: v }))}
              />

              {editError && <div className="text-red-400 text-xs border border-red-900 px-3 py-2">{editError}</div>}
              {editOk && <div className="text-green-400 text-xs">✓ Channels updated successfully.</div>}

              <div className="flex gap-2">
                <button
                  onClick={() => { setEditing(false); setEditError(null); setEditOk(false); }}
                  className="px-4 py-2 border border-blueprint-border text-blueprint-muted text-xs hover:border-blueprint-cyan hover:text-blueprint-cyan transition-colors"
                >
                  Cancel
                </button>
                <button
                  disabled={editSaving}
                  onClick={async () => {
                    setEditSaving(true);
                    setEditError(null);
                    try {
                      const ids = editForm.vaultChannelIds.split(",").map((s) => s.trim()).filter(Boolean);
                      const res = await fetch("/api/user/bot-config/patch", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          guildId: editForm.guildId.trim(),
                          vaultChannelIds: ids,
                          manifestChannelId: editForm.manifestChannelId.trim(),
                        }),
                      });
                      const data = await res.json() as { ok?: boolean; error?: string };
                      if (!res.ok) throw new Error(data.error ?? "Save failed");
                      setEditOk(true);
                      setEditing(false);
                      // Refresh config display
                      const cfg = await fetch("/api/user/bot-config").then((r) => r.json()) as ConfigDisplay;
                      setConfig(cfg);
                    } catch (err) {
                      setEditError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setEditSaving(false);
                    }
                  }}
                  className="flex-1 py-2 border border-blueprint-cyan text-blueprint-cyan text-xs uppercase tracking-widest hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors disabled:opacity-40"
                >
                  {editSaving ? "Validating & saving..." : "Save Channel Changes"}
                </button>
              </div>
            </div>
          )}

          {!config?.configured && (
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
              Send this to friends. It contains the <strong className="text-blueprint-cyanDim">server ID and channel IDs</strong> — they still create their own bot (Step 1–2 of setup) but the channel fields are pre-filled automatically. This is how everyone ends up on the <strong className="text-blueprint-cyanDim">same shared channels</strong> so all files are visible to everyone.
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
            Paste a code from a friend. It pre-fills the channel IDs so you connect to the same shared vault — you still need to create and invite your own bot first (Steps 1–2).
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

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-blueprint-muted text-xs font-mono">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-blueprint-bg border border-blueprint-border text-blueprint-cyanDim text-xs px-3 py-2 outline-none focus:border-blueprint-cyan font-mono"
      />
    </div>
  );
}
