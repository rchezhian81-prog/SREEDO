import { defineConfig } from "vitest/config";

// Unit tests only (no database required). Integration tests live under tests/
// and run via vitest.integration.config.ts.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
