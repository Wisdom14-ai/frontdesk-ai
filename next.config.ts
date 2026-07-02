import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  /**
   * Your Sentry org and project slugs from https://sentry.io/settings/
   * These are safe to commit — they only affect source-map uploads, not
   * error capturing (which uses the DSN stored in env vars).
   */
  org: process.env.SENTRY_ORG ?? "frontdesk-ai",
  project: process.env.SENTRY_PROJECT ?? "frontdesk-ai",

  // Suppress the Sentry CLI output during builds.
  silent: !process.env.CI,

  // Upload source maps to Sentry for readable stack traces.
  // Requires SENTRY_AUTH_TOKEN in the environment.
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },

  // Automatically instrument Next.js API routes.
  autoInstrumentServerFunctions: true,

  // Tree-shake Sentry SDK in the browser bundle when DSN is absent.
  disableLogger: true,
});
