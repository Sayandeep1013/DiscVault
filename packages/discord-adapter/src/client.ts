import { REST } from "@discordjs/rest";

export interface DiscordClientConfig {
  botToken: string;
}

export function createDiscordClient(config: DiscordClientConfig): REST {
  return new REST({ version: "10" }).setToken(config.botToken);
}

export class RateLimitError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    message: string
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
