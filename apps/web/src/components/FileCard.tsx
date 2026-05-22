"use client";

import { useState } from "react";
import type { Manifest } from "@discvault/core";
import { formatBytes, formatDate, fileIcon } from "@/lib/format";

interface FileCardProps {
  manifest: Manifest & { _serverName?: string };
}

export default function FileCard({ manifest }: FileCardProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const copyId = async () => {
    await navigator.clipboard.writeText(manifest.fileId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Use a plain anchor click — the browser handles the download natively,
  // streams directly to disk, shows its own progress in the download tray.
  // This avoids loading the entire file into JS memory (which crashes for large files).
  const download = () => {
    setDownloading(true);
    const a = document.createElement("a");
    a.href = `/api/download/${manifest.fileId}`;
    // filename* in Content-Disposition handles the real name; this is a fallback
    a.download = manifest.originalFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Reset button after short delay — browser has taken over the download
    setTimeout(() => setDownloading(false), 2000);
  };

  return (
    <div className="blueprint-panel p-4 flex flex-col gap-3 hover:border-blueprint-cyan transition-colors group">
      {/* File type icon + name */}
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none mt-0.5">{fileIcon(manifest.mimeType)}</span>
        <div className="flex-1 min-w-0">
          <div className="text-blueprint-cyanDim text-sm font-medium truncate" title={manifest.title}>
            {manifest.title}
          </div>
          <div className="text-blueprint-muted text-xs truncate" title={manifest.originalFilename}>
            {manifest.originalFilename}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-blueprint-muted">
        <span>{formatBytes(manifest.size)}</span>
        <span>{manifest.totalChunks} chunks</span>
        <span>{formatDate(manifest.createdAt)}</span>
        {manifest._serverName && (
          <span className="text-blueprint-cyanFaint border border-blueprint-cyanFaint px-1.5 py-0.5 text-xs" style={{ color: "#38bdf820", borderColor: "#1e3a5f" }}>
            <span style={{ color: "#7dd3fc" }}>⬡ {manifest._serverName}</span>
          </span>
        )}
      </div>

      {/* File ID */}
      <div className="font-mono text-xs text-blueprint-cyan bg-blueprint-bg border border-blueprint-cyanFaint px-2 py-1 truncate">
        [{manifest.fileId}]
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-auto pt-1">
        <button
          onClick={download}
          disabled={downloading}
          className="flex-1 py-1.5 text-xs border border-blueprint-cyan text-blueprint-cyan hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors disabled:opacity-50 disabled:cursor-wait uppercase tracking-wider"
        >
          {downloading ? "Loading..." : "↓ Download"}
        </button>
        <button
          onClick={copyId}
          className="px-3 py-1.5 text-xs border border-blueprint-border text-blueprint-muted hover:border-blueprint-cyan hover:text-blueprint-cyan transition-colors"
          title="Copy file ID"
        >
          {copied ? "✓" : "⎘"}
        </button>
      </div>
    </div>
  );
}
