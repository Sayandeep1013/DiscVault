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
          <p className="text-blueprint-muted text-xs leading-relaxed mb-4">
            DiscVault uses <strong className="text-blueprint-cyanDim">your own bot</strong> so your files stay on your own server. Takes about 2 minutes.
          </p>

          {/* Visual step-by-step */}
          <div className="flex flex-col gap-3">

            <GuideStep n="1" title="Open the Developer Portal">
              <span>Go to{" "}
                <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer"
                  className="text-blueprint-cyan hover:underline font-bold">
                  discord.com/developers/applications
                </a>
              </span>
            </GuideStep>

            <GuideStep n="2" title="Create a new application">
              Click <Kw>New Application</Kw> (top-right) → type any name (e.g. <Kw>MyVault</Kw>) → click <Kw>Create</Kw>
            </GuideStep>

            <GuideStep n="3" title="Add a bot to the application">
              In the left sidebar click <Kw>Bot</Kw> → click <Kw>Add Bot</Kw> → click <Kw>Yes, do it!</Kw>
            </GuideStep>

            <GuideStep n="4" title="Copy the bot token">
              <div className="flex flex-col gap-1">
                <span>Under <Kw>Token</Kw> → click <Kw>Reset Token</Kw> → confirm → click <Kw>Copy</Kw></span>
                <div className="border border-yellow-800 bg-yellow-950/30 px-3 py-2 text-yellow-400 text-xs mt-1">
                  ⚠ The token is shown only once. Copy it now before leaving the page.<br />
                  Never share it publicly — it gives full control of your bot.
                </div>
              </div>
            </GuideStep>

            <GuideStep n="5" title="Turn off Gateway Intents (important)">
              <div className="flex flex-col gap-1">
                <span>Scroll down on the Bot page to <Kw>Privileged Gateway Intents</Kw></span>
                <span>Turn <strong className="text-red-400">OFF</strong> all three toggles — DiscVault does not need them</span>
                <div className="text-blueprint-muted text-xs opacity-60 mt-1">
                  (Presence Intent, Server Members Intent, Message Content Intent — all OFF)
                </div>
              </div>
            </GuideStep>

          </div>

          {/* Token input */}
          <div className="mt-5 flex flex-col gap-1">
            <label className="text-blueprint-muted text-xs font-mono">
              BOT_TOKEN — paste what you copied in step 4
            </label>
            <input
              type="password"
              placeholder="MTUwNjg0OTg1OT..."
              value={form.botToken}
              onChange={set("botToken")}
              className="bg-blueprint-bg border border-blueprint-border text-blueprint-cyanDim text-xs px-3 py-2 outline-none focus:border-blueprint-cyan placeholder:text-blueprint-muted font-mono"
            />
            {form.botToken && !botClientId && (
              <div className="text-red-400 text-xs mt-1">
                ✗ Token format looks wrong — make sure you copied the full token from the <strong>Bot</strong> tab (not the Client Secret or Application ID).
              </div>
            )}
            {botClientId && (
              <div className="text-blueprint-cyan text-xs mt-1">✓ Token valid — Bot ID: {botClientId}</div>
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

        {/* ── Step 2: Invite + Permissions ── */}
        <StepPanel index={2} current={step} title="Invite Bot & Set Permissions">

          {/* 2a — Invite via our link */}
          <div className="flex flex-col gap-3">
            <div className="text-blueprint-cyan text-xs font-bold">A. Add the bot to your server</div>

            {/* Big prominent invite button */}
            {inviteUrl && (
              <a href={inviteUrl} target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-3 py-4 border-2 border-blueprint-cyan text-blueprint-cyan text-sm font-bold uppercase tracking-widest hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors">
                ↗ Click Here to Invite Your Bot
              </a>
            )}

            <div className="text-blueprint-muted text-xs">
              Select your server → click <strong className="text-blueprint-cyanDim">Authorize</strong> → complete the captcha.
            </div>

            {/* Warning about manual OAuth2 */}
            <div className="border border-yellow-800 bg-yellow-950/30 px-3 py-2 text-yellow-300 text-xs leading-relaxed">
              <strong>⚠ Use the button above — do NOT generate your own URL from Discord&apos;s OAuth2 page.</strong>
              <br />
              The Discord OAuth2 URL Generator shows permission checkboxes that are easy to miss.
              If you invite without permissions, the bot joins the server but cannot read or write anything.
              Our link already has all 4 required permissions encoded in it.
            </div>

            {/* Already invited without permissions? */}
            <details className="border border-blueprint-border text-xs">
              <summary className="px-3 py-2 text-blueprint-muted cursor-pointer hover:text-blueprint-cyan">
                Already invited the bot but it has no permissions? Fix it here ▾
              </summary>
              <div className="px-3 pb-3 pt-2 flex flex-col gap-2 text-blueprint-muted border-t border-blueprint-border">
                <div>You don&apos;t need to kick and re-invite. Just grant a role:</div>
                <div>1. Discord → your server → <strong className="text-blueprint-cyanDim">Server Settings</strong> → <strong className="text-blueprint-cyanDim">Roles</strong></div>
                <div>2. Create a new role (e.g. <code className="text-blueprint-cyan">vault-bot</code>) with these permissions:</div>
                <div className="border border-blueprint-border p-2 flex flex-col gap-0.5 ml-3">
                  <div className="text-blueprint-cyan">✓ View Channels</div>
                  <div className="text-blueprint-cyan">✓ Send Messages</div>
                  <div className="text-blueprint-cyan">✓ Attach Files</div>
                  <div className="text-blueprint-cyan">✓ Read Message History</div>
                </div>
                <div>3. Go to your server member list → find your bot → click it → <strong className="text-blueprint-cyanDim">Add Role</strong> → assign <code className="text-blueprint-cyan">vault-bot</code></div>
              </div>
            </details>
          </div>

          {/* 2b — Channel permissions for role-locked channels */}
          <div className="mt-5 flex flex-col gap-2">
            <div className="text-blueprint-cyan text-xs font-bold">B. If your channels are private / role-locked</div>
            <p className="text-blueprint-muted text-xs">
              The bot also needs explicit permission on each channel. Right-click the channel → <strong className="text-blueprint-cyanDim">Edit Channel</strong> → <strong className="text-blueprint-cyanDim">Permissions</strong> → add the bot&apos;s role and enable:
            </p>
            <div className="border border-blueprint-border p-3 text-xs flex flex-col gap-3">
              <div>
                <div className="text-blueprint-cyanDim font-bold mb-1">vault-001, vault-002, vault-003</div>
                <div className="text-blueprint-muted flex flex-col gap-0.5">
                  <div>✓ View Channel &nbsp;✓ Send Messages</div>
                  <div className="text-blueprint-cyan font-bold">✓ Attach Files  ← without this, uploads fail silently</div>
                </div>
              </div>
              <div>
                <div className="text-blueprint-cyanDim font-bold mb-1">manifests</div>
                <div className="text-blueprint-muted flex flex-col gap-0.5">
                  <div>✓ View Channel &nbsp;✓ Send Messages &nbsp;✓ Attach Files</div>
                  <div className="text-blueprint-cyan font-bold">✓ Read Message History  ← without this, file library is empty</div>
                </div>
              </div>
            </div>
          </div>

          {/* 2c — Setup channels */}
          <div className="mt-4 flex flex-col gap-2">
            <div className="text-blueprint-cyan text-xs font-bold">C. Create vault channels & copy IDs</div>
            <div className="border border-blueprint-border p-3 text-xs text-blueprint-muted flex flex-col gap-1">
              <div>1. Enable Developer Mode: Discord Settings → Advanced → Developer Mode → ON</div>
              <div>2. Create text channels: <code className="text-blueprint-cyan">vault-001</code>, <code className="text-blueprint-cyan">vault-002</code>, <code className="text-blueprint-cyan">vault-003</code>, <code className="text-blueprint-cyan">manifests</code></div>
              <div>3. Right-click server name → <strong className="text-blueprint-cyanDim">Copy Server ID</strong></div>
              <div>4. Right-click each channel → <strong className="text-blueprint-cyanDim">Copy Channel ID</strong></div>
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <button onClick={() => setStep(1)}
              className="px-4 py-2 border border-blueprint-border text-blueprint-muted text-xs uppercase tracking-widest hover:border-blueprint-cyan hover:text-blueprint-cyan transition-colors">
              ← Back
            </button>
            <button onClick={() => setStep(3)}
              className="flex-1 py-2 border border-blueprint-cyan text-blueprint-cyan text-xs uppercase tracking-widest hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors">
              Done, enter channel IDs →
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

// Numbered guide step with a connecting line
function GuideStep({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center shrink-0">
        <div className="w-5 h-5 border border-blueprint-cyan text-blueprint-cyan text-xs flex items-center justify-center font-bold shrink-0">
          {n}
        </div>
        <div className="w-px flex-1 bg-blueprint-border mt-1" />
      </div>
      <div className="flex flex-col gap-1 pb-3 flex-1">
        <div className="text-blueprint-cyanDim text-xs font-bold">{title}</div>
        <div className="text-blueprint-muted text-xs leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

// Keyword highlight — looks like a UI element label
function Kw({ children }: { children: React.ReactNode }) {
  return (
    <strong className="text-blueprint-cyanDim font-bold">{children}</strong>
  );
}
