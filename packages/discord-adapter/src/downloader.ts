import { Routes } from "discord-api-types/v10";
import type { REST } from "@discordjs/rest";
import { hashBuffer } from "@discvault/core";
import { sleep } from "./client.js";

const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 1000;

export async function downloadChunk(
  rest: REST,
  channelId: string,
  messageId: string,
  expectedSha256: string
): Promise<Buffer> {
  // Fetch the message to get the current CDN URL
  const message = (await rest.get(Routes.channelMessage(channelId, messageId))) as {
    attachments: Array<{ url: string; filename: string }>;
  };

  const attachment = message.attachments[0];
  if (!attachment) {
    throw new Error(`Message ${messageId} has no attachment`);
  }

  const data = await fetchWithRetry(attachment.url);

  const actualHash = hashBuffer(data);
  if (actualHash !== expectedSha256) {
    throw new Error(
      `Chunk SHA-256 mismatch for message ${messageId}. Expected ${expectedSha256}, got ${actualHash}`
    );
  }

  return data;
}

export async function fetchManifestFromChannel(
  rest: REST,
  manifestChannelId: string,
  fileId: string
): Promise<unknown> {
  // Scan recent messages in the manifests channel for one matching fileId
  let before: string | undefined;
  const limit = 100;

  for (let page = 0; page < 50; page++) {
    const searchParams = new URLSearchParams({ limit: String(limit) });
    if (before) searchParams.set("before", before);

    const messages = (await rest.get(Routes.channelMessages(manifestChannelId), {
      query: searchParams,
    })) as Array<{ id: string; attachments: Array<{ url: string; filename: string }> }>;

    if (messages.length === 0) break;

    for (const msg of messages) {
      for (const att of msg.attachments) {
        if (att.filename.startsWith(fileId) && att.filename.endsWith(".manifest.json")) {
          const data = await fetchWithRetry(att.url);
          return JSON.parse(data.toString("utf-8"));
        }
      }
    }

    before = messages[messages.length - 1]?.id;
  }

  return null;
}

async function fetchWithRetry(url: string): Promise<Buffer> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "1") * 1000;
        await sleep(retryAfter);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES - 1) {
        await sleep(BASE_RETRY_DELAY_MS * 2 ** attempt);
      }
    }
  }

  throw lastError;
}
