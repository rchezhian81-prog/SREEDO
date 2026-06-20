import { defineConfig } from "vitest/config";

// Pure-logic unit tests for the i18n core (no DOM needed). Runs in CI alongside
// the build.
export default defineConfig({
  // Use the automatic JSX runtime so component tests don't need a React import.
  esbuild: { jsx: "automatic" },
  test: {
    // Default to a node env (i18n core); component tests opt into jsdom via a
    // `// @vitest-environment jsdom` docblock at the top of the file.
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
