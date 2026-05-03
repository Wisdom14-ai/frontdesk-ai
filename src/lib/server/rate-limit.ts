import "server-only";

/**
 * Lightweight in-memory rate limiter using a sliding-window counter.
 *
 * Suitable for single-process deployments (VPS / PM2 single instance).
 * For multi-instance or serverless deployments, swap the Map for a
 * shared store such as Redis / Upstash.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();
let lastCleanup = Date.now();

/** Remove expired entries to prevent unbounded memory growth. */
function cleanup() {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
  lastCleanup = now;
}

export interface RateLimitOptions {
  /** Length of the sliding window in milliseconds. */
  windowMs: number;
  /** Maximum number of requests allowed in the window. */
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Remaining requests in the current window. */
  remaining: number;
  /** Unix timestamp (ms) when the current window resets. */
  resetAt: number;
}

/**
 * Check and increment the rate-limit counter for `key`.
 *
 * @param key    Unique identifier for the caller — e.g. `"send:${clinicId}"`.
 * @param options Window size and maximum request count.
 */
export function checkRateLimit(
  key: string,
  options: RateLimitOptions
): RateLimitResult {
  const now = Date.now();

  // Periodic cleanup every 5 minutes.
  if (now - lastCleanup > 5 * 60 * 1000) {
    cleanup();
  }

  const existing = store.get(key);

  if (!existing || now > existing.resetAt) {
    const entry: RateLimitEntry = { count: 1, resetAt: now + options.windowMs };
    store.set(key, entry);
    return { allowed: true, remaining: options.max - 1, resetAt: entry.resetAt };
  }

  existing.count += 1;

  if (existing.count > options.max) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  return {
    allowed: true,
    remaining: options.max - existing.count,
    resetAt: existing.resetAt,
  };
}
