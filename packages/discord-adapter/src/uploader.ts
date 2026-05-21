import { Routes } from "discord-api-types/v10";
import type { REST } from "@discordjs/rest";
import { sleep } from "./client.js";

export interface UploadedChunk {
  messageId: string;
  channelId: string;
  attachmentUrl: string;
}

const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 1000;

export async function uploadChunk(
  rest: REST,
  channelId: string,
  filename: string,
  data: Buffer
): Promise<UploadedChunk> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = (await rest.post(Routes.channelMessages(channelId), {
        files: [{ data, name: filename, contentType: "application/octet-stream" }],
        body: { attachments: [{ id: "0", filename }] },
      })) as { id: string; attachments: Array<{ url: string }> };

      const attachment = response.attachments[0];
      if (!attachment) throw new Error("Discord returned no attachment");

      return {
        messageId: response.id,
        channelId,
        attachmentUrl: attachment.url,
      };
    } catch (err: unknown) {
      lastError = err;

      if (isRateLimitError(err)) {
        const retryAfter = getRetryAfterMs(err) ?? BASE_RETRY_DELAY_MS * 2 ** attempt;
        console.error(`  [rate limit] waiting ${retryAfter}ms before retry...`);
        await sleep(retryAfter);
        continue;
      }

      const { status, code, message } = extractDiscordError(err);

      // Permissions errors — no point retrying, fail immediately with clear message
      if (status === 403) {
        throw new DiscordPermissionError(channelId, code, message);
      }

      if (attempt < MAX_RETRIES - 1) {
        console.error(`  [upload] attempt ${attempt + 1} failed (${message}), retrying...`);
        await sleep(BASE_RETRY_DELAY_MS * 2 ** attempt);
      }
    }
  }

  throw lastError;
}

export class DiscordPermissionError extends Error {
  constructor(
    public readonly channelId: string,
    public readonly discordCode: number | null,
    message: string
  ) {
    const hint = getPermissionHint(discordCode);
    super(
      `Discord permission error on channel ${channelId}: ${message}${hint ? `\n  → Fix: ${hint}` : ""}`
    );
    this.name = "DiscordPermissionError";
  }
}

function getPermissionHint(code: number | null): string | null {
  switch (code) {
    case 50001:
      return 'Bot is missing access to this channel. In Discord: channel settings → Permissions → add your bot role with "View Channel".';
    case 50013:
      return 'Bot is missing permissions. In Discord: channel settings → Permissions → enable "Send Messages" and "Attach Files" for the bot.';
    case 50035:
      return "File too large. Discord free servers allow max 10MB per attachment.";
    default:
      return null;
  }
}

function isRateLimitError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;
  return e["status"] === 429 || e["code"] === 429;
}

function getRetryAfterMs(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as Record<string, unknown>;
  const raw = e["retryAfter"] ?? e["retry_after"];
  if (typeof raw === "number") return raw * 1000;
  return null;
}

function extractDiscordError(err: unknown): {
  status: number | null;
  code: number | null;
  message: string;
} {
  if (typeof err !== "object" || err === null) {
    return { status: null, code: null, message: String(err) };
  }
  const e = err as Record<string, unknown>;
  return {
    status: typeof e["status"] === "number" ? e["status"] : null,
    code: typeof e["code"] === "number" ? e["code"] : null,
    message: typeof e["message"] === "string" ? e["message"] : String(err),
  };
}
