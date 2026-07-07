import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // SQL migration files must ship with the serverless bundle (db init runs them)
  outputFileTracingIncludes: {
    "/**/*": ["./drizzle/**/*"],
  },
};

export default nextConfig;
