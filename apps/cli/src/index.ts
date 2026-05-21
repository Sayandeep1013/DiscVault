import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runUpload } from "./commands/upload.js";
import { runDownload } from "./commands/download.js";
import { runList } from "./commands/list.js";
import { runShare } from "./commands/share.js";

const program = new Command();

program
  .name("discvault")
  .description("Store and restore large files via Discord")
  .version("0.0.1");

program
  .command("init")
  .description("Set up Discord bot token and channel configuration")
  .action(async () => {
    await runInit();
  });

program
  .command("upload <file>")
  .description("Upload a file to Discord storage")
  .option("-t, --title <title>", "Display title for the file")
  .action(async (file: string, opts: { title?: string }) => {
    await runUpload(file, opts);
  });

program
  .command("download <fileId>")
  .description("Restore a file from Discord storage")
  .option("-o, --output <path>", "Output file path")
  .action(async (fileId: string, opts: { output?: string }) => {
    await runDownload(fileId, opts);
  });

program
  .command("list")
  .description("List all uploaded files")
  .action(async () => {
    await runList();
  });

program
  .command("share <fileId>")
  .description("Show share instructions for a file")
  .action(async (fileId: string) => {
    await runShare(fileId);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
