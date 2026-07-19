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
        // PR-UI1 typography — self-hosted @font-face in globals.css, applied only
        // under `.ui-v2`. `sans` above is intentionally unchanged so the default
        // look is byte-identical while the flag is off.
        display: [
          "Manrope",
          "ui-sans-serif",
          "system-ui",
          "Segoe UI",
          "Roboto",
          "Noto Sans Tamil",
          "sans-serif",
        ],
        tamil: ["Noto Sans Tamil", "Latha", "Nirmala UI", "sans-serif"],
      },
      colors: {
        // Refined GoCampus professional blue. Made variable-backed (PR-UI1) so the
        // `.ui-v2` skin can retheme it to violet/indigo; each CSS var defaults to
        // the exact previous hex, so `.ui-v2`-off rendering is unchanged.
        brand: {
          50: "rgb(var(--brand-50) / <alpha-value>)",
          100: "rgb(var(--brand-100) / <alpha-value>)",
          200: "rgb(var(--brand-200) / <alpha-value>)",
          300: "rgb(var(--brand-300) / <alpha-value>)",
          400: "rgb(var(--brand-400) / <alpha-value>)",
          500: "rgb(var(--brand-500) / <alpha-value>)",
          600: "rgb(var(--brand-600) / <alpha-value>)",
          700: "rgb(var(--brand-700) / <alpha-value>)",
          800: "rgb(var(--brand-800) / <alpha-value>)",
          900: "rgb(var(--brand-900) / <alpha-value>)",
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
        // Semantic status tokens (PX3) — flip in dark mode, support /alpha.
        success: "rgb(var(--c-success) / <alpha-value>)",
        warn: "rgb(var(--c-warn) / <alpha-value>)",
        danger: "rgb(var(--c-danger) / <alpha-value>)",
        info: "rgb(var(--c-info) / <alpha-value>)",
        // PR-UI1 action/secondary accents — var-backed; default to the legacy blue
        // so `.ui-v2`-off is identical, violet/indigo/gold under `.ui-v2`.
        accent: "rgb(var(--c-accent) / <alpha-value>)",
        "accent-strong": "rgb(var(--c-accent-strong) / <alpha-value>)",
        gold: "rgb(var(--c-gold) / <alpha-value>)",
        "accent-indigo": "rgb(var(--c-indigo) / <alpha-value>)",
        "chart-primary": "rgb(var(--chart-1) / <alpha-value>)",
      },
      boxShadow: {
        // Elevation is var-backed (PR-UI1) so `.ui-v2` can soften it; the defaults
        // are byte-identical to the previous shadows, so `.ui-v2`-off is unchanged.
        card: "var(--elevation-1)",
        pop: "var(--elevation-2)",
        float: "var(--elevation-3)",
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
