"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Discord bot tokens encode the bot's client ID in their first segment (base64).
// This lets us build the invite URL without asking the user to find it separately.
function extractBotClientId(token: string): string | null {
  try {
    const firstSegment = token.trim().split(".")[0];
    if (!firstSegment) return null;
    // Pad base64 if needed
    const padded = firstSegment + "=".repeat((4 - (firstSegment.length % 4)) % 4);
    return atob(padded);
  } catch {
    return null;
  }
}

function buildInviteUrl(clientId: string): string {
  // Permissions: View Channel (1024) + Send Messages (2048) + Attach Files (32768) + Read Message History (65536)
  const perms = 1024 + 2048 + 32768 + 65536;
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${perms}&scope=bot`;
}

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState({
    botToken: "",
    guildId: "",
    vaultChannelIds: "",
    manifestChannelId: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const botClientId = extractBotClientId(form.botToken);
  const inviteUrl = botClientId ? buildInviteUrl(botClientId) : null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const vaultChannelIds = form.vaultChannelIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (vaultChannelIds.length === 0) throw new Error("Enter at least one vault channel ID");

      const res = await fetch("/api/user/bot-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, vaultChannelIds }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setSaved(true); // show success before navigating
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen relative z-10">
      <nav className="border-b border-blueprint-border bg-blueprint-navy px-6 py-3 flex items-center gap-3">
        <div className="w-8 h-8 border border-blueprint-cyan flex items-center justify-center text-blueprint-cyan text-xs font-bold">DV</div>
        <span className="text-blueprint-cyan text-xs uppercase tracking-widest font-bold">// Vault Setup</span>
        <span className="text-blueprint-muted text-xs ml-auto">Step {step} of 3</span>
      </nav>

      <main className="px-6 py-8 max-w-xl mx-auto flex flex-col gap-5">

        {/* ── Step 1: Create the bot ── */}
        <StepPanel index={1} current={step} title="Create a Discord Bot">
          <p className="text-blueprint-muted text-xs leading-relaxed">
            DiscVault uses your own Discord bot so your files stay on your own server.
            You only need to do this once.
          </p>
          <ol className="text-blueprint-muted text-xs flex flex-col gap-2 mt-3 list-none">
            <li className="flex gap-2"><span className="text-blueprint-cyan shrink-0">1.</span>
              Go to{" "}
              <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer"
                className="text-blueprint-cyan hover:underline">
                discord.com/developers/applications
              </a>
            </li>
            <li className="flex gap-2"><span className="text-blueprint-cyan shrink-0">2.</span>
              Click <strong className="text-blueprint-cyanDim">New Application</strong> → give it any name → Create
            </li>
            <li className="flex gap-2"><span className="text-blueprint-cyan shrink-0">3.</span>
              Left sidebar → <strong className="text-blueprint-cyanDim">Bot</strong> → click <strong className="text-blueprint-cyanDim">Add Bot</strong> → confirm
            </li>
            <li className="flex gap-2"><span className="text-blueprint-cyan shrink-0">4.</span>
              Click <strong className="text-blueprint-cyanDim">Reset Token</strong> → copy it
            </li>
          </ol>

          <div className="mt-4 flex flex-col gap-1">
            <label className="text-blueprint-muted text-xs font-mono">BOT_TOKEN</label>
            <input
              type="password"
              placeholder="MTUwNjg0OTg1OT..."
              value={form.botToken}
              onChange={set("botToken")}
              className="bg-blueprint-bg border border-blueprint-border text-blueprint-cyanDim text-xs px-3 py-2 outline-none focus:border-blueprint-cyan placeholder:text-blueprint-muted font-mono"
            />
            {form.botToken && !botClientId && (
              <div className="text-red-400 text-xs">Token format looks wrong — paste the full token from the Bot page.</div>
            )}
            {botClientId && (
              <div className="text-blueprint-cyan text-xs">✓ Bot ID detected: {botClientId}</div>
            )}
          </div>

          <button
            disabled={!botClientId}
            onClick={() => setStep(2)}
            className="mt-4 w-full py-2.5 border border-blueprint-cyan text-blueprint-cyan text-xs uppercase tracking-widest hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next: Add bot to your server →
          </button>
        </StepPanel>

        {/* ── Step 2: Invite the bot ── */}
        <StepPanel index={2} current={step} title="Add Bot to Your Discord Server">
          <p className="text-blueprint-muted text-xs leading-relaxed">
            Your bot needs to be in the server where you want to store files.
            Click the button below — it uses your bot token to generate the correct invite link automatically.
          </p>

          {inviteUrl && (
            <a
              href={inviteUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 flex items-center justify-center gap-2 w-full py-2.5 border border-blueprint-cyan text-blueprint-cyan text-xs uppercase tracking-widest hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors"
            >
              ↗ Open Discord Bot Invite
            </a>
          )}

          <div className="mt-4 border border-blueprint-border p-3 text-xs text-blueprint-muted flex flex-col gap-1">
            <div className="text-blueprint-cyanDim font-bold mb-1">After inviting:</div>
            <div>1. In Discord, enable <strong className="text-blueprint-cyanDim">Developer Mode</strong>: Settings → Advanced → Developer Mode → ON</div>
            <div>2. Create text channels: <code className="text-blueprint-cyan">vault-001</code>, <code className="text-blueprint-cyan">vault-002</code>, <code className="text-blueprint-cyan">vault-003</code>, <code className="text-blueprint-cyan">manifests</code></div>
            <div>3. Right-click your server name → <strong className="text-blueprint-cyanDim">Copy Server ID</strong></div>
            <div>4. Right-click each channel → <strong className="text-blueprint-cyanDim">Copy Channel ID</strong></div>
          </div>

          <div className="flex gap-2 mt-4">
            <button onClick={() => setStep(1)}
              className="px-4 py-2 border border-blueprint-border text-blueprint-muted text-xs uppercase tracking-widest hover:border-blueprint-cyan hover:text-blueprint-cyan transition-colors">
              ← Back
            </button>
            <button onClick={() => setStep(3)}
              className="flex-1 py-2 border border-blueprint-cyan text-blueprint-cyan text-xs uppercase tracking-widest hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors">
              I've done this → Enter channel IDs
            </button>
          </div>
        </StepPanel>

        {/* ── Step 3: Channel IDs ── */}
        <StepPanel index={3} current={step} title="Connect Your Server">
          <div className="flex flex-col gap-4">
            <Field label="SERVER_ID (Guild ID)" placeholder="Right-click server name → Copy Server ID"
              value={form.guildId} onChange={set("guildId")} />
            <Field label="VAULT_CHANNEL_IDS" placeholder="id1, id2, id3 (the vault-001/002/003 channels)"
              value={form.vaultChannelIds} onChange={set("vaultChannelIds")} />
            <Field label="MANIFEST_CHANNEL_ID" placeholder="The manifests channel ID"
              value={form.manifestChannelId} onChange={set("manifestChannelId")} />
          </div>

          {/* Error — full width, hard to miss */}
          {error && (
            <div className="border border-red-500 bg-red-950/40 px-4 py-3 mt-2">
              <div className="text-red-400 text-xs font-bold mb-1">✗ Setup failed</div>
              <div className="text-red-300 text-xs leading-relaxed">{error}</div>
            </div>
          )}

          {/* Success */}
          {saved && (
            <div className="border border-green-500 bg-green-950/40 px-4 py-3 mt-2 text-center">
              <div className="text-green-400 text-sm font-bold mb-2">✓ Bot connected successfully!</div>
              <div className="text-blueprint-muted text-xs mb-3">Your vault is ready.</div>
              <button
                onClick={() => router.push("/")}
                className="px-6 py-2 border border-blueprint-cyan text-blueprint-cyan text-xs uppercase tracking-widest hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors"
              >
                Open Vault →
              </button>
            </div>
          )}

          {!saved && (
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setStep(2); setError(null); }}
                className="px-4 py-2 border border-blueprint-border text-blueprint-muted text-xs uppercase tracking-widest hover:border-blueprint-cyan hover:text-blueprint-cyan transition-colors">
                ← Back
              </button>
              <button
                onClick={save}
                disabled={saving || !form.guildId || !form.vaultChannelIds || !form.manifestChannelId}
                className="flex-1 py-2 border border-blueprint-cyan text-blueprint-cyan text-xs uppercase tracking-widest hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? "Validating bot access..." : "Save & Open Vault →"}
              </button>
            </div>
          )}
        </StepPanel>

      </main>
    </div>
  );
}

function StepPanel({ index, current, title, children }: {
  index: 1 | 2 | 3;
  current: number;
  title: string;
  children: React.ReactNode;
}) {
  const active = index === current;
  const done = index < current;
  return (
    <div className={`blueprint-panel p-5 transition-opacity ${active ? "opacity-100" : "opacity-40"}`}>
      <div className="flex items-center gap-3 mb-4 pb-2 border-b border-blueprint-border">
        <div className={`w-6 h-6 border flex items-center justify-center text-xs font-bold shrink-0 ${done ? "border-green-500 text-green-500" : active ? "border-blueprint-cyan text-blueprint-cyan" : "border-blueprint-border text-blueprint-muted"}`}>
          {done ? "✓" : index}
        </div>
        <span className={`text-xs uppercase tracking-widest font-bold ${active ? "text-blueprint-cyan" : "text-blueprint-muted"}`}>
          {title}
        </span>
      </div>
      {active && children}
      {done && <div className="text-blueprint-muted text-xs">Complete ✓</div>}
      {!active && !done && <div className="text-blueprint-muted text-xs">Complete the previous step first.</div>}
    </div>
  );
}

function Field({ label, placeholder, value, onChange }: {
  label: string; placeholder: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-blueprint-muted text-xs font-mono">{label}</label>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="bg-blueprint-bg border border-blueprint-border text-blueprint-cyanDim text-xs px-3 py-2 outline-none focus:border-blueprint-cyan placeholder:text-blueprint-muted font-mono"
      />
    </div>
  );
}
