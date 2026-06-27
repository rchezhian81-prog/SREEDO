import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Pure-logic unit tests for the i18n core plus a11y component tests. Runs in CI
// alongside the build.
export default defineConfig({
  // Match the app's `@/* -> src/*` path alias (tsconfig) so tested modules that
  // import via `@/...` resolve the same way Next/tsc resolve them.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Use the automatic JSX runtime so component tests don't need a React import.
  esbuild: { jsx: "automatic" },
  test: {
    // Default to a node env (i18n core); component tests opt into jsdom via a
    // `// @vitest-environment jsdom` docblock at the top of the file.
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
