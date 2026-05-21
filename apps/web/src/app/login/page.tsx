"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const ERROR_MESSAGES: Record<string, string> = {
  missing_params: "Login failed — missing parameters from Discord.",
  invalid_state: "Login failed — state mismatch (possible CSRF). Try again.",
  auth_failed: "Login failed — Discord returned an error. Try again.",
};

function LoginContent() {
  const params = useSearchParams();
  const error = params.get("error");

  return (
    <div className="min-h-screen flex items-center justify-center relative z-10">
      <div className="blueprint-panel p-10 text-center max-w-sm w-full mx-4">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 border border-blueprint-cyan flex items-center justify-center text-blueprint-cyan font-bold">
            DV
          </div>
          <span className="text-blueprint-cyan font-bold tracking-widest uppercase">DiscVault</span>
        </div>

        <div className="text-blueprint-cyanDim text-sm mb-2">// File Archive System</div>
        <div className="text-blueprint-muted text-xs mb-8">
          Sign in with your Discord account to access your vault.
        </div>

        {error && (
          <div className="text-red-400 text-xs mb-4 border border-red-900 px-3 py-2">
            {ERROR_MESSAGES[error] ?? "An error occurred. Please try again."}
          </div>
        )}

        <a
          href="/api/auth/login"
          className="flex items-center justify-center gap-3 w-full px-6 py-3 border border-blueprint-cyan text-blueprint-cyan text-xs uppercase tracking-widest hover:bg-blueprint-cyan hover:text-blueprint-bg transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 71 55" fill="currentColor">
            <path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.4831 44.2898 53.5502 44.3433C53.9057 44.6363 54.2779 44.9293 54.6529 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0921 48.2228C48.9662 48.2707 48.9102 48.4172 48.9718 48.5383C50.038 50.6034 51.2554 52.5699 52.5959 54.435C52.6519 54.5139 52.7526 54.5477 52.845 54.5195C58.6464 52.7249 64.529 50.0174 70.6019 45.5576C70.6551 45.5182 70.6887 45.459 70.6943 45.3942C72.1747 30.0791 68.2147 16.7757 60.1968 4.9823C60.1772 4.9429 60.1437 4.9147 60.1045 4.8978Z"/>
          </svg>
          Sign in with Discord
        </a>

        <div className="mt-6 text-blueprint-muted text-xs opacity-50">
          Only your Discord username is read. No messages, no servers.
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
