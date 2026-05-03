import * as Sentry from "@sentry/nextjs";

/**
 * Sentry edge-runtime initialisation (Next.js middleware + edge routes).
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,

  enabled: !!(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN),

  tracesSampleRate: 0.05,
});
