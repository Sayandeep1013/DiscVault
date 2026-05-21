"use client";

import { useCallback, useRef, useState } from "react";
import { formatBytes } from "@/lib/format";

const CHUNK_SIZE = 9 * 1024 * 1024; // 9 MB

interface UploadedChunkInfo {
  index: number;
  messageId: string;
  channelId: string;
  guildId: string;
  chunkSha256: string;
}

interface FileUploadJob {
  id: string;
  file: File;
  status: "queued" | "uploading" | "done" | "error";
  chunk: number;
  total: number;
  bytes: number;
  fileId?: string;
  error?: string;
  startedAt?: number;
}

interface UploadModalProps {
  onClose: () => void;
  onDone: () => void;
}

let jobCounter = 0;

function hexFromBuffer(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function UploadModal({ onClose, onDone }: UploadModalProps) {
  const [phase, setPhase] = useState<"pick" | "uploading" | "allDone">("pick");
  const [jobs, setJobs] = useState<FileUploadJob[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const updateJob = (id: string, patch: Partial<FileUploadJob>) =>
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const uploadOne = useCallback(async (job: FileUploadJob) => {
    updateJob(job.id, { status: "uploading", startedAt: Date.now() });

    const file = job.file;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    // Generate a unique file ID on the client
    const fileId =
      "vv_" +
      Array.from(crypto.getRandomValues(new Uint8Array(7)))
        .map((b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[b % 62])
        .join("");

    updateJob(job.id, { total: totalChunks });

    const uploadedChunks: UploadedChunkInfo[] = [];

    try {
      for (let i = 0; i < totalChunks; i++) {
        if (abortRef.current?.signal.aborted) throw new Error("Cancelled");

        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        // File.slice does NOT load the whole file — reads only this 9MB window
        const chunkBuf = await file.slice(start, end).arrayBuffer();

        // Per-chunk SHA-256 using built-in WebCrypto
        const sha256Buf = await crypto.subtle.digest("SHA-256", chunkBuf);
        const chunkSha256 = hexFromBuffer(sha256Buf);

        // Each chunk is a small, independent POST — no HTTP/2 streaming body issues
        const res = await fetch("/api/upload/chunk", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-file-id": fileId,
            "x-chunk-index": String(i),
            "x-filename": encodeURIComponent(file.name),
          },
          body: chunkBuf,
        });

        if (!res.ok) {
          const err = await res.json() as { error?: string };
          throw new Error(err.error ?? `Chunk ${i} upload failed (HTTP ${res.status})`);
        }

        const data = await res.json() as { messageId: string; channelId: string; guildId: string };
        uploadedChunks.push({ index: i, ...data, chunkSha256 });

        updateJob(job.id, {
          chunk: i + 1,
          total: totalChunks,
          bytes: end,
        });
      }

      // Finalize — save manifest in DB and post to Discord
      const finalRes = await fetch("/api/upload/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          filename: file.name,
          title: file.name,
          size: file.size,
          chunks: uploadedChunks,
        }),
      });

      if (!finalRes.ok) {
        const err = await finalRes.json() as { error?: string };
        throw new Error(err.error ?? "Failed to save manifest");
      }

      updateJob(job.id, { status: "done", fileId, bytes: file.size });
    } catch (err) {
      updateJob(job.id, {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const startAll = useCallback(
    async (newJobs: FileUploadJob[]) => {
      setPhase("uploading");
      abortRef.current = new AbortController();
      for (const job of newJobs) {
        await uploadOne(job);
      }
      setPhase("allDone");
      onDone();
    },
    [uploadOne, onDone]
  );

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    const newJobs: FileUploadJob[] = arr.map((f) => ({
      id: String(++jobCounter),
      file: f,
      status: "queued",
      chunk: 0,
      total: 0,
      bytes: 0,
    }));
    setJobs((prev) => [...prev, ...newJobs]);
    if (phase === "pick") void startAll(newJobs);
  };

  const totalFiles = jobs.length;
  const doneCount = jobs.filter((j) => j.status === "done").length;
  const errorCount = jobs.filter((j) => j.status === "error").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="blueprint-panel w-full max-w-xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-blueprint-border shrink-0">
          <span className="text-blueprint-cyan text-xs uppercase tracking-widest font-bold">
            {phase === "pick"
              ? "// Upload Files"
              : phase === "uploading"
              ? `// Uploading ${doneCount}/${totalFiles}`
              : `// Done — ${doneCount}/${totalFiles} uploaded`}
          </span>
          <button onClick={onClose} className="text-blueprint-muted hover:text-blueprint-cyan text-lg leading-none">
            ×
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 overflow-y-auto flex-1">
          {/* Drop zone */}
          {phase !== "allDone" && (
            <div
              className={`border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
                dragOver ? "border-blueprint-cyan bg-blueprint-cyan/5" : "border-blueprint-border hover:border-blueprint-cyanDim"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.multiple = true;
                input.onchange = () => { if (input.files?.length) addFiles(input.files); };
                input.click();
              }}
            >
              <div className="text-blueprint-muted text-xs uppercase tracking-widest">
                {jobs.length === 0 ? "Drag & drop or click — select multiple files" : "+ Add more files"}
              </div>
            </div>
          )}

          {/* Job list */}
          {jobs.length > 0 && (
            <div className="flex flex-col gap-3">
              {jobs.map((job) => {
                const pct = job.file.size > 0 ? Math.round((job.bytes / job.file.size) * 100) : 0;
                return (
                  <div key={job.id} className="border border-blueprint-border p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-blueprint-cyanDim text-xs truncate flex-1" title={job.file.name}>
                        {job.file.name}
                      </span>
                      <span className="text-blueprint-muted text-xs shrink-0">{formatBytes(job.file.size)}</span>
                      <StatusBadge status={job.status} />
                    </div>

                    {job.status === "uploading" && (
                      <>
                        <div className="w-full h-1.5 bg-blueprint-bg border border-blueprint-border">
                          <div
                            className="h-full bg-blueprint-cyan transition-all duration-300"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="text-xs text-blueprint-muted flex justify-between">
                          <span>{pct}%</span>
                          {job.total > 0 && <span>Chunk {job.chunk}/{job.total}</span>}
                          <span>{formatBytes(job.bytes)} / {formatBytes(job.file.size)}</span>
                        </div>
                      </>
                    )}

                    {job.status === "done" && job.fileId && (
                      <div className="font-mono text-xs text-blueprint-cyan bg-blueprint-bg border border-blueprint-cyanFaint px-2 py-1">
                        [{job.fileId}]
                      </div>
                    )}

                    {job.status === "error" && (
                      <div className="text-xs text-red-400">{job.error}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {phase === "allDone" && (
            <div className="text-center py-2">
              <div className="text-blueprint-cyan text-2xl mb-2">✓</div>
              <div className="text-blueprint-cyanDim text-sm">
                {doneCount} file{doneCount !== 1 ? "s" : ""} uploaded
                {errorCount > 0 && <span className="text-red-400 ml-2">({errorCount} failed)</span>}
              </div>
              <button
                onClick={onClose}
                className="mt-4 px-6 py-2 border border-blueprint-cyan text-blueprint-cyan text-xs uppercase tracking-widest hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: FileUploadJob["status"] }) {
  const map = {
    queued: { label: "Queued", cls: "text-blueprint-muted border-blueprint-border" },
    uploading: { label: "Uploading", cls: "text-blueprint-cyan border-blueprint-cyan animate-pulse" },
    done: { label: "Done", cls: "text-green-400 border-green-400" },
    error: { label: "Error", cls: "text-red-400 border-red-400" },
  };
  const { label, cls } = map[status];
  return <span className={`text-xs border px-1.5 py-0.5 shrink-0 ${cls}`}>{label}</span>;
}
