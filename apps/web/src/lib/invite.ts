import type { DiscVaultConfig } from "./config";

const PREFIX = "DISCVAULT:";

// Server config (shareable — contains channel IDs but NO bot token)
export interface ServerConfig {
  guildId: string;
  vaultChannelIds: string[];
  manifestChannelId: string;
}

// Generate an invite code that shares channel config only — each friend brings their own bot token
export function encodeInvite(config: DiscVaultConfig): string {
  const serverConfig: ServerConfig = {
    guildId: config.guildId,
    vaultChannelIds: config.vaultChannelIds,
    manifestChannelId: config.manifestChannelId,
  };
  return PREFIX + Buffer.from(JSON.stringify(serverConfig), "utf-8").toString("base64");
}

export function decodeInvite(code: string): ServerConfig {
  const trimmed = code.trim();
  if (!trimmed.startsWith(PREFIX)) {
    throw new Error("Invalid invite code — must start with DISCVAULT:");
  }
  const b64 = trimmed.slice(PREFIX.length);
  const raw = JSON.parse(Buffer.from(b64, "base64").toString("utf-8")) as Record<string, unknown>;

  if (typeof raw["guildId"] !== "string" || !Array.isArray(raw["vaultChannelIds"]) || typeof raw["manifestChannelId"] !== "string") {
    throw new Error("Invite code is missing required fields");
  }
  return {
    guildId: raw["guildId"],
    vaultChannelIds: raw["vaultChannelIds"] as string[],
    manifestChannelId: raw["manifestChannelId"],
  };
}
