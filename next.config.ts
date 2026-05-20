import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Netlify handles its own output format — don't use standalone
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
