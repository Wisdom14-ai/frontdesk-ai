import * as Sentry from "@sentry/nextjs";

/**
 * Sentry server-side (Node.js) initialisation.
 * Set SENTRY_DSN in your environment to enable.
 *
 * This file is automatically picked up by @sentry/nextjs.
 * All unhandled exceptions in API routes and server components are captured.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,

  enabled: !!(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN),

  // Lower sample rate for traces to avoid noise; errors are always sent.
  tracesSampleRate: 0.05,

  // Tag every error with the environment so you can filter in Sentry.
  environment: process.env.NODE_ENV ?? "development",
});
