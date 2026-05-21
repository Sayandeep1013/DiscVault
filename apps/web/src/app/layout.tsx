import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DiscVault",
  description: "Large file archive over Discord",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen relative z-10" suppressHydrationWarning>{children}</body>
    </html>
  );
}
