import { readFile, writeFile, mkdir } from "node:fs/promises";
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

export async function loadConfig(): Promise<DiscVaultConfig | null> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as DiscVaultConfig;
  } catch {
    return null;
  }
}

export async function saveConfig(config: DiscVaultConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  const enc = new TextEncoder();
  const bytes = enc.encode(JSON.stringify(config, null, 2));
  await writeFile(CONFIG_PATH, bytes);
}
