import { defineConfig } from "vitest/config";

// Pure-logic unit tests for the i18n core (no DOM needed). Runs in CI alongside
// the build.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
