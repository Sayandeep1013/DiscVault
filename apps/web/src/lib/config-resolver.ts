import type { NextRequest } from "next/server";
import { getAuthContext } from "./auth";
import { botConfigToDiscVaultConfig } from "./db";
import { loadConfig } from "./config";
import type { DiscVaultConfig } from "./config";

export interface ResolvedConfig {
  config: DiscVaultConfig;
  userId: string | null;
  username: string | null;
}

export async function resolveConfig(req: NextRequest): Promise<ResolvedConfig | null> {
  // 1. Auth session (DB bot config)
  const ctx = await getAuthContext(req);
  if (ctx?.botConfig) {
    try {
      const config = await botConfigToDiscVaultConfig(ctx.botConfig);
      return { config, userId: ctx.userId, username: ctx.username };
    } catch {
      // decryption failed — fall through
    }
  }

  // 2. Local config file (CLI fallback / local dev)
  const local = await loadConfig();
  if (local) return { config: local, userId: null, username: null };

  return null;
}
