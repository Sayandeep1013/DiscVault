import { input, password } from "@inquirer/prompts";
import { saveConfig } from "../config.js";

export async function runInit(): Promise<void> {
  console.log("\nDiscVault Setup\n");
  console.log("You need a Discord bot token and your server's channel IDs.");
  console.log("See: https://discord.com/developers/applications\n");

  const botToken = await password({
    message: "Bot token (from Discord Developer Portal → Bot → Token):",
    validate: (v) => (v.length > 20 ? true : "Paste the full bot token"),
  });

  const guildId = await input({
    message: "Discord server (guild) ID:",
    validate: (v) => (/^\d+$/.test(v) ? true : "Enter numeric Discord server ID"),
  });

  console.log(
    "\nEnter vault channel IDs (comma-separated). These store file chunks."
  );
  console.log('Example: vault-001, vault-002, vault-003 channel IDs\n');
  const vaultChannelsRaw = await input({
    message: "Vault channel IDs:",
    validate: (v) => (v.trim().length > 0 ? true : "Enter at least one channel ID"),
  });

  const manifestChannelId = await input({
    message: "Manifest channel ID (stores file metadata for sharing):",
    validate: (v) => (/^\d+$/.test(v) ? true : "Enter numeric channel ID"),
  });

  const vaultChannelIds = vaultChannelsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  await saveConfig({ botToken, guildId, vaultChannelIds, manifestChannelId });

  console.log("\n✓ Config saved to ~/.discvault/config.json");
  console.log(
    `  ${vaultChannelIds.length} vault channel(s), 1 manifest channel\n`
  );
}
