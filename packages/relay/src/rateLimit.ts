import { config } from "./config.js";

type Entry = { count: number; resetAt: number; lastAt: number };

const byWallet = new Map<string, Entry>();

export type RateLimitResult = { allowed: true } | { allowed: false; reason: "too-fast" | "too-many"; retryAfterMs: number };

/**
 * Per-wallet in-memory rate limit with two knobs:
 *  - A minimum gap between consecutive posts (blocks machine-gun spam)
 *  - A rolling window cap (blocks sustained spam)
 *
 * Per-process state. Survives across requests but is wiped on restart.
 * Fine for Phase 1; swap for Redis if we ever run multiple relay replicas.
 */
export function checkRateLimit(wallet: string): RateLimitResult {
  const now = Date.now();
  const key = wallet.toLowerCase();
  const entry = byWallet.get(key);

  if (!entry || now > entry.resetAt) {
    byWallet.set(key, { count: 1, resetAt: now + config.rateLimitWindowMs, lastAt: now });
    return { allowed: true };
  }

  if (now - entry.lastAt < config.rateLimitMinGapMs) {
    return { allowed: false, reason: "too-fast", retryAfterMs: config.rateLimitMinGapMs - (now - entry.lastAt) };
  }
  if (entry.count >= config.rateLimitMax) {
    return { allowed: false, reason: "too-many", retryAfterMs: entry.resetAt - now };
  }

  entry.count += 1;
  entry.lastAt = now;
  return { allowed: true };
}

/** Back out a rate-limit slot when a post fails after we'd counted it. */
export function releaseRateLimit(wallet: string) {
  const entry = byWallet.get(wallet.toLowerCase());
  if (entry && entry.count > 0) entry.count -= 1;
}
