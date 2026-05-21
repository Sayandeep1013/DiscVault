"use client";

import { useCallback, useRef, useState } from "react";
import { formatBytes } from "@/lib/format";

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

export default function UploadModal({ onClose, onDone }: UploadModalProps) {
  const [phase, setPhase] = useState<"pick" | "uploading" | "allDone">("pick");
  const [jobs, setJobs] = useState<FileUploadJob[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const updateJob = (id: string, patch: Partial<FileUploadJob>) =>
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const uploadOne = useCallback(async (job: FileUploadJob) => {
    updateJob(job.id, { status: "uploading", startedAt: Date.now() });

    // Abort automatically if server doesn't respond within 15 seconds
    const timeoutId = setTimeout(() => abortRef.current?.abort(), 15_000);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-filename": encodeURIComponent(job.file.name),
          "x-title": encodeURIComponent(job.file.name),
          "Content-Length": String(job.file.size),
        },
        body: job.file,
        // @ts-expect-error duplex needed for streaming body
        duplex: "half",
      });

      if (!res.body) throw new Error("No response stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const ev = JSON.parse(part.slice(6)) as Record<string, unknown>;
          if (ev["type"] === "heartbeat") {
            // Server acknowledged the request — chunking is starting
            updateJob(job.id, { status: "uploading" });
          } else if (ev["type"] === "progress") {
            updateJob(job.id, {
              chunk: Number(ev["chunk"]),
              total: Number(ev["total"]) > 0 ? Number(ev["total"]) : job.total,
              bytes: Number(ev["bytes"]) || 0,
            });
          } else if (ev["type"] === "done") {
            updateJob(job.id, { status: "done", fileId: String(ev["fileId"]), bytes: job.file.size });
          } else if (ev["type"] === "error") {
            updateJob(job.id, { status: "error", error: String(ev["message"]) });
          }
        }
      }
    } catch (err) {
      const isTimeout = (err as Error).name === "AbortError";
      updateJob(job.id, {
        status: "error",
        error: isTimeout
          ? "Server did not respond in time. Check your internet connection and try again."
          : String(err),
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  const startAll = useCallback(
    async (newJobs: FileUploadJob[]) => {
      setPhase("uploading");
      abortRef.current = new AbortController();
      // Upload sequentially — Discord rate limits make parallel uploads hit 429s
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
    if (phase === "pick") {
      void startAll(newJobs);
    }
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
          {/* Drop zone — always visible so you can add more */}
          {phase !== "allDone" && (
            <div
              className={`border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
                dragOver ? "border-blueprint-cyan bg-blueprint-cyan/5" : "border-blueprint-border hover:border-blueprint-cyanDim"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
              }}
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

          {/* All done summary */}
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
