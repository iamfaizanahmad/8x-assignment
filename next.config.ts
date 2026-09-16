import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A second local server (e.g. for testing) must not share build output with the main one.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
