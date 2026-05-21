import type { DiscVaultConfig } from "./config";

const PREFIX = "DISCVAULT:";

export function encodeInvite(config: DiscVaultConfig): string {
  const json = JSON.stringify(config);
  return PREFIX + Buffer.from(json, "utf-8").toString("base64");
}

export function decodeInvite(code: string): DiscVaultConfig {
  const trimmed = code.trim();
  if (!trimmed.startsWith(PREFIX)) {
    throw new Error("Invalid invite code — must start with DISCVAULT:");
  }
  const b64 = trimmed.slice(PREFIX.length);
  const json = Buffer.from(b64, "base64").toString("utf-8");
  const config = JSON.parse(json) as DiscVaultConfig;
  if (!config.botToken || !config.guildId || !config.vaultChannelIds || !config.manifestChannelId) {
    throw new Error("Invite code is missing required fields");
  }
  return config;
}
