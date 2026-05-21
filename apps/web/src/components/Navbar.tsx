"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface User {
  username: string;
  hasBotConfig: boolean;
}

interface NavbarProps {
  onUploadClick: () => void;
}

export default function Navbar({ onUploadClick }: NavbarProps) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { authenticated?: boolean; username?: string; hasBotConfig?: boolean } | null) => {
        if (d?.authenticated) setUser({ username: d.username ?? "", hasBotConfig: d.hasBotConfig ?? false });
      })
      .catch(() => null);
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  return (
    <nav className="relative z-20 border-b border-blueprint-border bg-blueprint-navy px-6 py-3 flex items-center justify-between">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-3">
        <div className="w-8 h-8 border border-blueprint-cyan flex items-center justify-center text-blueprint-cyan text-xs font-bold">
          DV
        </div>
        <span className="text-blueprint-cyan font-bold tracking-widest text-sm uppercase">DiscVault</span>
        <span className="text-blueprint-muted text-xs hidden sm:block">// file archive v0.1</span>
      </Link>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={onUploadClick}
          className="flex items-center gap-2 px-4 py-2 border border-blueprint-cyan text-blueprint-cyan text-xs uppercase tracking-widest hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors"
        >
          <span>↑</span>
          <span>Upload</span>
        </button>
        <Link
          href="/settings"
          className="flex items-center gap-2 px-3 py-2 border border-blueprint-border text-blueprint-muted text-xs uppercase tracking-widest hover:border-blueprint-cyan hover:text-blueprint-cyan transition-colors"
        >
          <span>⚙</span>
        </Link>
        {user ? (
          <div className="flex items-center gap-2">
            <span className="text-blueprint-cyanDim text-xs hidden sm:block">@{user.username}</span>
            <button
              onClick={logout}
              className="px-3 py-2 border border-blueprint-border text-blueprint-muted text-xs hover:border-red-900 hover:text-red-400 transition-colors"
              title="Sign out"
            >
              ⏻
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="px-3 py-2 border border-blueprint-border text-blueprint-muted text-xs uppercase tracking-widest hover:border-blueprint-cyan hover:text-blueprint-cyan transition-colors"
          >
            Login
          </Link>
        )}
      </div>
    </nav>
  );
}
