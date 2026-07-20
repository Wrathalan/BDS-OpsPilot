import type { NextConfig } from "next";
import { createSecurityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: [...createSecurityHeaders()] }];
  },
};

export default nextConfig;
