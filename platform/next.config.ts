import type { NextConfig } from "next";

/**
 * Security headers (docs/SECURITY.md):
 *  - CSP: no external script origins; 'unsafe-inline' is required by Next's
 *    hydration payload and Tailwind's injected styles. Server-side satellite
 *    fetches don't need connect-src (browser never calls them).
 *  - frame-ancestors none: farm financial data never renders in an iframe.
 *  - HSTS is set by Vercel on *.vercel.app; declared here for custom domains.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // SQL migration files must ship with the serverless bundle (db init runs them)
  outputFileTracingIncludes: {
    "/**/*": ["./drizzle/**/*"],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
