import { DB_PATH } from "../config.js";
import { openDb, listFiles } from "../db/store.js";

export async function runList(): Promise<void> {
  const db = await openDb(DB_PATH);
  const files = listFiles(db);

  if (files.length === 0) {
    console.log("\nNo files uploaded yet. Run: discvault upload <file>\n");
    return;
  }

  console.log(`\n${"ID".padEnd(15)} ${"Title".padEnd(30)} ${"Size".padStart(10)} ${"Chunks".padStart(7)}  ${"Date"}`);
  console.log("-".repeat(85));

  for (const f of files) {
    const date = new Date(f.createdAt).toLocaleDateString();
    console.log(
      `${f.id.padEnd(15)} ${f.title.slice(0, 29).padEnd(30)} ${formatBytes(f.size).padStart(10)} ${String(f.totalChunks).padStart(7)}  ${date}`
    );
  }
  console.log();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
