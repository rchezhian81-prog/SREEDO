import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      colors: {
        // Refined GoCampus professional blue
        brand: {
          50: "#eef4ff",
          100: "#dbe7ff",
          200: "#bcd3ff",
          300: "#8fb4ff",
          400: "#5b8def",
          500: "#3b6ef0",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
        },
        // Semantic tokens — backed by CSS vars so they flip in dark mode.
        app: "rgb(var(--c-app) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        "surface-2": "rgb(var(--c-surface-2) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        ink: "rgb(var(--c-ink) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        faint: "rgb(var(--c-faint) / <alpha-value>)",
        hover: "rgb(var(--c-hover) / <alpha-value>)",
      },
      boxShadow: {
        card: "0 1px 2px rgb(20 30 55 / 0.04), 0 6px 20px rgb(20 30 55 / 0.07)",
        pop: "0 10px 30px rgb(20 30 55 / 0.12)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1rem",
      },
    },
  },
  plugins: [],
};

export default config;
