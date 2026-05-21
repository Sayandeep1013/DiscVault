import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_DIR = join(homedir(), ".discvault");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const DB_PATH = join(CONFIG_DIR, "vault.db");

export interface DiscVaultConfig {
  botToken: string;
  guildId: string;
  vaultChannelIds: string[];
  manifestChannelId: string;
}

export async function loadConfig(): Promise<DiscVaultConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as DiscVaultConfig;
  } catch {
    throw new Error(
      `Config not found. Run "discvault init" to set up your Discord connection.`
    );
  }
}

export async function saveConfig(config: DiscVaultConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export function isConfigured(config: DiscVaultConfig): boolean {
  return (
    config.botToken.length > 0 &&
    config.guildId.length > 0 &&
    config.vaultChannelIds.length > 0 &&
    config.manifestChannelId.length > 0
  );
}
