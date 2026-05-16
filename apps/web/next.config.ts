import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { NextConfig } from "next";

const __dirname = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  // Tracing root must be the monorepo root so Next picks up workspace packages.
  outputFileTracingRoot: resolve(__dirname, "..", ".."),
  transpilePackages: [
    "@nemocognition/core",
    "@nemocognition/tracing",
    "@nemocognition/nemoclaw",
    "@nemocognition/db",
    "@nemocognition/recovery",
    "@nemocognition/video",
  ],
};

export default nextConfig;
