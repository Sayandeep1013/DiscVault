"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface ServerEntry {
  guildId: string;
  guildName: string;
  botUsername: string;
  vaultChannelIds: string[];
  manifestChannelId: string;
}

interface ConfigDisplay {
  configured: boolean;
  servers: ServerEntry[];
}

export default function SettingsPage() {
  const router = useRouter();
  const [config, setConfig] = useState<ConfigDisplay | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [importCode, setImportCode] = useState("");
  const [importError, setImportError] = useState("");
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [loadingInvite, setLoadingInvite] = useState(false);

  // Editing
  const [editingGuildId, setEditingGuildId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ vaultChannelIds: "", manifestChannelId: "", guildId: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editOk, setEditOk] = useState(false);

  // Removing
  const [removingGuildId, setRemovingGuildId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const loadConfig = () =>
    fetch("/api/user/bot-config")
      .then((r) => r.json())
      .then((d) => {
        // Only update config if the response is valid — never silently clear servers
        const data = d as ConfigDisplay;
        if (Array.isArray(data.servers)) setConfig(data);
      })
      .catch(() => {
        // Don't clear existing config on fetch error — keeps servers visible
      });

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d: { authenticated?: boolean }) => { if (!d.authenticated) router.replace("/login"); })
      .catch(() => router.replace("/login"));

    void loadConfig();
  }, [router]);

  const generateInvite = async () => {
    setLoadingInvite(true);
    try {
      const res = await fetch("/api/invite");
      const data = await res.json() as { code?: string };
      if (data.code) setInviteCode(data.code);
    } finally {
      setLoadingInvite(false);
    }
  };

  const removeServer = async (guildId: string) => {
    setRemovingGuildId(guildId);
    setRemoveError(null);
    try {
      const res = await fetch(`/api/user/bot-config?guildId=${encodeURIComponent(guildId)}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      // Immediately update local state so there's no flicker waiting for loadConfig
      setConfig((prev) => prev ? { ...prev, servers: prev.servers.filter((s) => s.guildId !== guildId) } : prev);
      // Then sync from server
      await loadConfig();
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Failed to remove server");
    } finally {
      setRemovingGuildId(null);
    }
  };

  const startEdit = (s: ServerEntry) => {
    setEditingGuildId(s.guildId);
    setEditForm({ guildId: s.guildId, vaultChannelIds: s.vaultChannelIds.join(", "), manifestChannelId: s.manifestChannelId });
    setEditError(null);
    setEditOk(false);
  };

  const saveEdit = async () => {
    setEditSaving(true);
    setEditError(null);
    try {
      const ids = editForm.vaultChannelIds.split(",").map((s) => s.trim()).filter(Boolean);
      const res = await fetch("/api/user/bot-config/patch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guildId: editForm.guildId.trim(), vaultChannelIds: ids, manifestChannelId: editForm.manifestChannelId.trim() }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setEditOk(true);
      setEditingGuildId(null);
      await loadConfig();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditSaving(false);
    }
  };

  const joinWithCode = async () => {
    if (!importCode.trim()) return;
    setImportError("");
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteCode: importCode.trim() }),
    });
    const data = await res.json() as { ok?: boolean; serverConfig?: { guildId: string; vaultChannelIds: string[]; manifestChannelId: string }; error?: string };
    if (data.ok && data.serverConfig) {
      const params = new URLSearchParams({
        guildId: data.serverConfig.guildId,
        vaultChannelIds: data.serverConfig.vaultChannelIds.join(","),
        manifestChannelId: data.serverConfig.manifestChannelId,
      });
      window.location.href = `/setup?${params}`;
    } else {
      setImportError(data.error ?? "Invalid invite code");
    }
  };

  const servers = config?.servers ?? [];

  return (
    <div className="min-h-screen relative z-10">
      <nav className="border-b border-blueprint-border bg-blueprint-navy px-6 py-3 flex items-center gap-4">
        <Link href="/" className="text-blueprint-muted text-xs hover:text-blueprint-cyan transition-colors">← Back to Vault</Link>
        <span className="text-blueprint-border">|</span>
        <span className="text-blueprint-cyan text-xs uppercase tracking-widest font-bold">// Settings</span>
      </nav>

      <main className="px-6 py-8 max-w-2xl mx-auto flex flex-col gap-6">

        {/* Connected Servers */}
        <section className="blueprint-panel p-5">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-blueprint-border">
            <div className="text-blueprint-cyan text-xs uppercase tracking-widest font-bold">
              Connected Servers ({servers.length})
            </div>
            <Link href="/setup"
              className="text-xs border border-blueprint-cyan text-blueprint-cyan px-3 py-1 hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors">
              + Add Server
            </Link>
          </div>

          {servers.length === 0 && (
            <div className="text-blueprint-muted text-xs">No servers connected. <Link href="/setup" className="text-blueprint-cyan hover:underline">Set up your first bot →</Link></div>
          )}
          {removeError && (
            <div className="text-red-400 text-xs border border-red-900 px-3 py-2">{removeError}</div>
          )}

          <div className="flex flex-col gap-4">
            {servers.map((s) => (
              <div key={s.guildId} className="border border-blueprint-border p-4 flex flex-col gap-3">
                {editingGuildId === s.guildId ? (
                  /* Edit mode */
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-blueprint-cyan font-bold">⬡ {s.guildName || s.guildId}</span>
                      <span className="text-blueprint-muted">@{s.botUsername}</span>
                    </div>
                    <EF label="GUILD_ID" value={editForm.guildId} onChange={(v) => setEditForm((f) => ({ ...f, guildId: v }))} />
                    <EF label="VAULT_CHANNEL_IDS" value={editForm.vaultChannelIds} onChange={(v) => setEditForm((f) => ({ ...f, vaultChannelIds: v }))} />
                    <EF label="MANIFEST_CHANNEL_ID" value={editForm.manifestChannelId} onChange={(v) => setEditForm((f) => ({ ...f, manifestChannelId: v }))} />
                    {editError && <div className="text-red-400 text-xs">{editError}</div>}
                    <div className="flex gap-2">
                      <button onClick={() => setEditingGuildId(null)}
                        className="px-3 py-1.5 border border-blueprint-border text-blueprint-muted text-xs hover:border-blueprint-cyan hover:text-blueprint-cyan transition-colors">
                        Cancel
                      </button>
                      <button onClick={saveEdit} disabled={editSaving}
                        className="flex-1 py-1.5 border border-blueprint-cyan text-blueprint-cyan text-xs uppercase tracking-wider hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors disabled:opacity-40">
                        {editSaving ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-blueprint-cyan text-sm font-bold">⬡ {s.guildName || s.guildId}</span>
                          <span className="text-blueprint-muted text-xs">bot: @{s.botUsername || "unknown"}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => startEdit(s)}
                          className="text-xs border border-blueprint-border text-blueprint-muted px-2 py-1 hover:border-blueprint-cyan hover:text-blueprint-cyan transition-colors">
                          ✎ Edit
                        </button>
                        <button
                          onClick={() => { if (confirm(`Remove ${s.guildName || s.guildId} from your vault?`)) void removeServer(s.guildId); }}
                          disabled={removingGuildId === s.guildId}
                          className="text-xs border border-blueprint-border text-blueprint-muted px-2 py-1 hover:border-red-600 hover:text-red-400 transition-colors disabled:opacity-40">
                          {removingGuildId === s.guildId ? "..." : "✕"}
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
                      <Row label="SERVER_ID" value={s.guildId} />
                      <Row label="MANIFEST_CH" value={s.manifestChannelId} />
                      <Row label="VAULT_CHANNELS" value={`${s.vaultChannelIds.length} channel${s.vaultChannelIds.length !== 1 ? "s" : ""}`} />
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Invite Code — Generate */}
        {servers.length > 0 && (
          <section className="blueprint-panel p-5">
            <div className="text-blueprint-cyan text-xs uppercase tracking-widest font-bold mb-3 pb-2 border-b border-blueprint-border">
              Share Vault with Friends
            </div>
            <p className="text-blueprint-muted text-xs mb-4">
              The invite code contains your <strong className="text-blueprint-cyanDim">server ID and channel IDs</strong> — friends bring their own bot. Everyone on the same channels sees the same files.
            </p>
            <button onClick={generateInvite} disabled={loadingInvite}
              className="px-4 py-2 border border-blueprint-cyan text-blueprint-cyan text-xs uppercase tracking-widest hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors disabled:opacity-50">
              {loadingInvite ? "Generating..." : "Generate Invite Code"}
            </button>
            {inviteCode && (
              <div className="mt-3 flex flex-col gap-2">
                <div className="bg-blueprint-bg border border-blueprint-cyanFaint px-3 py-2 text-xs text-blueprint-cyan font-mono break-all">{inviteCode}</div>
                <button onClick={async () => { await navigator.clipboard.writeText(inviteCode); setCopiedInvite(true); setTimeout(() => setCopiedInvite(false), 1500); }}
                  className="self-start text-xs border border-blueprint-border text-blueprint-muted px-3 py-1.5 hover:border-blueprint-cyan hover:text-blueprint-cyan transition-colors">
                  {copiedInvite ? "✓ Copied" : "⎘ Copy"}
                </button>
              </div>
            )}
          </section>
        )}

        {/* Join with Invite Code */}
        <section className="blueprint-panel p-5">
          <div className="text-blueprint-cyan text-xs uppercase tracking-widest font-bold mb-3 pb-2 border-b border-blueprint-border">
            Join a Vault
          </div>
          <p className="text-blueprint-muted text-xs mb-3">
            Paste a code from a friend. It pre-fills the channel IDs — you still create your own bot first.
          </p>
          <div className="flex gap-2">
            <input type="text" placeholder="DISCVAULT:eyJ..."
              value={importCode}
              onChange={(e) => { setImportCode(e.target.value); setImportError(""); }}
              className="flex-1 bg-blueprint-bg border border-blueprint-border text-blueprint-cyanDim text-xs px-3 py-2 outline-none focus:border-blueprint-cyan placeholder:text-blueprint-muted font-mono"
            />
            <button onClick={joinWithCode} disabled={!importCode.trim()}
              className="px-4 py-2 border border-blueprint-cyan text-blueprint-cyan text-xs uppercase tracking-widest hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors disabled:opacity-40">
              Join
            </button>
          </div>
          {importError && <div className="mt-2 text-xs text-red-400">{importError}</div>}
        </section>

      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 min-w-0">
      <span className="text-blueprint-muted shrink-0">{label}</span>
      <span className="text-blueprint-cyanDim truncate">{value}</span>
    </div>
  );
}

function EF({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-blueprint-muted text-xs font-mono">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
        className="bg-blueprint-bg border border-blueprint-border text-blueprint-cyanDim text-xs px-3 py-2 outline-none focus:border-blueprint-cyan font-mono" />
    </div>
  );
}
