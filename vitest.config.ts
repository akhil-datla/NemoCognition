import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/e2e/**"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "apps/*/src/**"],
    },
  },
  resolve: {
    alias: {
      "@nemocognition/core": path.resolve(__dirname, "packages/core/src"),
      "@nemocognition/tracing": path.resolve(__dirname, "packages/tracing/src"),
      "@nemocognition/nemoclaw": path.resolve(__dirname, "packages/nemoclaw/src"),
      "@nemocognition/db": path.resolve(__dirname, "packages/db/src"),
      "@nemocognition/recovery": path.resolve(__dirname, "packages/recovery/src"),
      "@nemocognition/video": path.resolve(__dirname, "packages/video/src"),
    },
  },
});
