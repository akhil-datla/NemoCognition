import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { NextConfig } from "next";

const __dirname = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  // Tracing root must be the monorepo root so Next picks up workspace packages.
  outputFileTracingRoot: resolve(__dirname, "..", ".."),
  // Force the standalone bundle to copy these into the runtime node_modules.
  // Workspace package source IS being traced (we see `packages/db/src/...`
  // imports work), but the *transitive* deps declared inside those workspace
  // packages aren't picked up automatically.
  outputFileTracingIncludes: {
    "/**/*": [
      "../../node_modules/.pnpm/postgres@*/node_modules/postgres/**",
      "../../node_modules/.pnpm/drizzle-orm@*/node_modules/drizzle-orm/**",
    ],
  },
  // Keep these as runtime requires rather than letting Next try to bundle
  // them into a chunk (they use native bindings / dynamic requires).
  serverExternalPackages: ["postgres", "drizzle-orm"],
  transpilePackages: [
    "@nemocognition/core",
    "@nemocognition/tracing",
    "@nemocognition/nemoclaw",
    "@nemocognition/db",
    "@nemocognition/recovery",
    "@nemocognition/video",
    "@nemocognition/cli",
  ],
};

export default nextConfig;
