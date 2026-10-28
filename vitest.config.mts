import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname), "server-only": path.resolve(import.meta.dirname, "tests/unit/server-only-stub.ts") } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    globalSetup: ["tests/unit/global-setup.ts"],
    setupFiles: ["tests/unit/setup-env.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
