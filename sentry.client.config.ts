import * as Sentry from "@sentry/nextjs";

/**
 * Sentry browser/client-side initialisation.
 * Set NEXT_PUBLIC_SENTRY_DSN in your environment to enable.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only capture errors in production.
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Adjust sample rate — 1.0 = 100 % of errors.
  tracesSampleRate: 0.1,

  // Do not capture noisy browser extension errors.
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "Non-Error promise rejection captured",
  ],
});
