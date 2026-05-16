import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@nemocognition/core",
    "@nemocognition/tracing",
    "@nemocognition/db",
    "@nemocognition/recovery",
  ],
};

export default nextConfig;
