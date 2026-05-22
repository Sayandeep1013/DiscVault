"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Manifest } from "@discvault/core";
import Navbar from "@/components/Navbar";
import FileCard from "@/components/FileCard";
import UploadModal from "@/components/UploadModal";

export default function LibraryPage() {
  const router = useRouter();
  const [files, setFiles] = useState<Manifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [search, setSearch] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);
  const [scanInfo, setScanInfo] = useState<{ messagesScanned: number; manifestsFound: number; parseErrors: number; fetchErrors: number } | null>(null);

  // Auth gate — redirect to /login if not signed in
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d: { authenticated?: boolean; hasBotConfig?: boolean }) => {
        if (!d.authenticated) {
          router.replace("/login");
        } else if (!d.hasBotConfig) {
          router.replace("/setup");
        }
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  const fetchFiles = useCallback(async (bustCache = false) => {
    setLoading(true);
    setError(null);
    try {
      if (bustCache) await fetch("/api/files", { method: "DELETE" });
      const res = await fetch("/api/files");
      if (res.status === 404) { setNotConfigured(true); setLoading(false); return; }
      if (res.status === 503) {
        // DB waking up — retry once after 2 seconds
        await new Promise((r) => setTimeout(r, 2000));
        const retry = await fetch("/api/files");
        if (!retry.ok) throw new Error("Server temporarily unavailable. Please refresh.");
        const retryData = await retry.json() as { files: Manifest[]; error?: string; _scan?: typeof scanInfo };
        if (retryData.error) throw new Error(retryData.error);
        setFiles(retryData.files);
        if (retryData._scan) setScanInfo(retryData._scan);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { files: Manifest[]; error?: string; _scan?: typeof scanInfo };
      if (data.error) throw new Error(data.error);
      setFiles(data.files);
      if (data._scan) setScanInfo(data._scan);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchFiles(); }, [fetchFiles]);

  const filtered = files.filter(
    (f) =>
      f.title.toLowerCase().includes(search.toLowerCase()) ||
      f.originalFilename.toLowerCase().includes(search.toLowerCase()) ||
      f.fileId.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar onUploadClick={() => setShowUpload(true)} />

      <main className="flex-1 relative z-10 px-6 py-6 max-w-7xl mx-auto w-full">
        {/* Header row */}
        <div className="flex items-center justify-between mb-6 gap-4">
          <div>
            <h1 className="text-blueprint-cyan text-sm uppercase tracking-widest font-bold">
              // Vault Library
            </h1>
            {!loading && !error && (
              <p className="text-blueprint-muted text-xs mt-1">
                {files.length} file{files.length !== 1 ? "s" : ""} stored across Discord
                {scanInfo && scanInfo.messagesScanned > 0 && (
                  <span className="ml-2 opacity-50">
                    · scanned {scanInfo.messagesScanned} messages
                    {(scanInfo.parseErrors + scanInfo.fetchErrors) > 0 && (
                      <span className="text-yellow-500 ml-1">· {scanInfo.parseErrors + scanInfo.fetchErrors} failed to load</span>
                    )}
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search files..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-blueprint-bg border border-blueprint-border text-blueprint-cyanDim text-xs px-3 py-1.5 w-48 outline-none focus:border-blueprint-cyan placeholder:text-blueprint-muted"
            />
            <button
              onClick={() => void fetchFiles(true)}
              className="px-3 py-1.5 border border-blueprint-border text-blueprint-muted text-xs hover:border-blueprint-cyan hover:text-blueprint-cyan transition-colors"
              title="Refresh from Discord"
            >
              ↺
            </button>
          </div>
        </div>

        {/* Not configured */}
        {notConfigured && (
          <div className="blueprint-panel p-8 text-center">
            <div className="text-blueprint-cyan text-3xl mb-4">⚙</div>
            <div className="text-blueprint-cyanDim text-sm mb-2">DiscVault is not configured</div>
            <div className="text-blueprint-muted text-xs mb-4">
              Connect your Discord server to get started.
            </div>
            <a
              href="/settings"
              className="inline-block px-6 py-2 border border-blueprint-cyan text-blueprint-cyan text-xs uppercase tracking-widest hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors"
            >
              Open Settings →
            </a>
          </div>
        )}

        {/* Loading */}
        {loading && !notConfigured && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-8 h-8 border-2 border-blueprint-cyanFaint border-t-blueprint-cyan animate-spin" />
            <div className="text-blueprint-muted text-xs uppercase tracking-widest">
              Scanning Discord manifests channel...
            </div>
          </div>
        )}

        {/* Error */}
        {error && !notConfigured && (
          <div className="blueprint-panel p-6 border border-red-900">
            <div className="text-red-400 text-xs font-bold mb-1">Failed to load files</div>
            <div className="text-red-300 text-xs">{error}</div>
            {error.includes("403") || error.includes("Read Message History") ? (
              <div className="mt-2 text-yellow-400 text-xs">
                Fix: Discord → manifests channel → Edit Channel → Permissions → enable ✓ Read Message History for your bot.
              </div>
            ) : null}
            <button onClick={() => void fetchFiles(true)} className="mt-3 text-xs text-blueprint-muted hover:text-blueprint-cyan">
              ↺ Retry
            </button>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && !notConfigured && files.length === 0 && (
          <div className="blueprint-panel p-8 text-center flex flex-col gap-3">
            <div className="text-blueprint-muted text-xs uppercase tracking-widest">
              No files found in manifests channel
            </div>
            {scanInfo && (
              <div className="text-blueprint-muted text-xs opacity-60">
                Scanned {scanInfo.messagesScanned} message{scanInfo.messagesScanned !== 1 ? "s" : ""}.
                {scanInfo.messagesScanned === 0
                  ? " The manifests channel appears to be empty."
                  : scanInfo.parseErrors + scanInfo.fetchErrors > 0
                  ? ` ${scanInfo.parseErrors + scanInfo.fetchErrors} manifest(s) failed to parse — check Render logs.`
                  : " No .manifest.json files found in any messages."}
              </div>
            )}
            <div className="flex gap-3 justify-center mt-2">
              <button
                onClick={() => setShowUpload(true)}
                className="px-6 py-2 border border-blueprint-cyan text-blueprint-cyan text-xs uppercase tracking-widest hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors"
              >
                ↑ Upload First File
              </button>
              <button
                onClick={() => void fetchFiles(true)}
                className="px-4 py-2 border border-blueprint-border text-blueprint-muted text-xs uppercase tracking-widest hover:border-blueprint-cyan hover:text-blueprint-cyan transition-colors"
              >
                ↺ Rescan
              </button>
            </div>
          </div>
        )}

        {/* File grid */}
        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((f) => (
              <FileCard key={f.fileId} manifest={f} />
            ))}
          </div>
        )}

        {/* No search results */}
        {!loading && files.length > 0 && filtered.length === 0 && (
          <div className="text-center py-12 text-blueprint-muted text-xs">
            No files match &quot;{search}&quot;
          </div>
        )}
      </main>

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onDone={() => {
            setShowUpload(false);
            void fetchFiles(true);
          }}
        />
      )}
    </div>
  );
}
