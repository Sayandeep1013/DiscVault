import { DB_PATH } from "../config.js";
import { openDb, getFile } from "../db/store.js";

export async function runShare(fileId: string): Promise<void> {
  const db = await openDb(DB_PATH);
  const file = getFile(db, fileId);

  if (!file) {
    console.error(`\n✗ File "${fileId}" not found in local vault.\n`);
    process.exit(1);
  }

  console.log(`\nFile:    ${file.title}`);
  console.log(`ID:      ${file.id}`);
  console.log(`Size:    ${formatBytes(file.size)}`);
  console.log(`Chunks:  ${file.totalChunks}`);
  console.log();
  console.log("Share this file ID with your friend:");
  console.log();
  console.log(`  ${file.id}`);
  console.log();
  console.log("They can restore it with:");
  console.log();
  console.log(`  discvault download ${file.id}`);
  console.log();
  console.log("(Both of you need bot access to the same Discord server)\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
