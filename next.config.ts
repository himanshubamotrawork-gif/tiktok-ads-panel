import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "@modelcontextprotocol/sdk"],
};

export default nextConfig;
