export default function CliSuccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center relative z-10">
      <div className="blueprint-panel p-10 text-center max-w-sm w-full mx-4">
        <div className="text-blueprint-cyan text-4xl mb-4">✓</div>
        <div className="text-blueprint-cyan text-sm uppercase tracking-widest font-bold mb-2">
          Login Successful
        </div>
        <div className="text-blueprint-muted text-xs">
          You can close this tab and return to your terminal.
        </div>
      </div>
    </div>
  );
}
