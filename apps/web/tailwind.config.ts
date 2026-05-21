import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        blueprint: {
          bg: "#0a0f1e",
          navy: "#0d1529",
          panel: "#0f1a2e",
          border: "#1e3a5f",
          borderHover: "#38bdf8",
          cyan: "#38bdf8",
          cyanDim: "#7dd3fc",
          cyanFaint: "#1e3a5f",
          text: "#e2e8f0",
          muted: "#64748b",
          accent: "#0ea5e9",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Space Mono", "Fira Code", "monospace"],
      },
      backgroundImage: {
        "blueprint-grid":
          "radial-gradient(circle, #1e3a5f 1px, transparent 1px)",
      },
      backgroundSize: {
        "blueprint-grid": "28px 28px",
      },
    },
  },
  plugins: [],
};

export default config;
