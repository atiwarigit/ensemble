import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema/analytics";

export type RateLimit = { limit: number; windowSec: number };

export const LIMITS = {
  /** Failed password attempts for one email from one address. */
  signInFailuresPerEmail: { limit: 10, windowSec: 15 * 60 },
  /** Password attempts from one address across all emails. */
  signInPerIp: { limit: 100, windowSec: 15 * 60 },
  /** TOTP / backup codes per pending sign-in: a fresh password step is needed after this. */
  totpPerAttempt: { limit: 5, windowSec: 15 * 60 },
  chatPerUser: { limit: 30, windowSec: 5 * 60 },
} satisfies Record<string, RateLimit>;

export const hashKey = (...parts: (string | null | undefined)[]) =>
  createHash("sha256").update(parts.map((p) => p ?? "").join("|")).digest("hex").slice(0, 32);

/**
 * Fixed-window counter in Postgres, so limits hold across serverless instances. Counts the attempt
 * and reports whether it's within the limit.
 */
export async function hitRateLimit(key: string, { limit, windowSec }: RateLimit, now = Date.now()) {
  const windowStart = new Date(Math.floor(now / (windowSec * 1000)) * windowSec * 1000);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } })
    .returning({ count: rateLimits.count });
  const retryAfter = Math.max(1, Math.ceil((windowStart.getTime() + windowSec * 1000 - now) / 1000));
  return { ok: row.count <= limit, count: row.count, retryAfter };
}

/** Reads the current window's count without counting an attempt (for failure-only limits). */
export async function peekRateLimit(key: string, { limit, windowSec }: RateLimit, now = Date.now()) {
  const windowStart = new Date(Math.floor(now / (windowSec * 1000)) * windowSec * 1000);
  const rows = await db.execute<{ count: number }>(
    sql`select count from rate_limits where key = ${key} and window_start = ${windowStart.toISOString()}`,
  );
  const count = rows[0]?.count ?? 0;
  const retryAfter = Math.max(1, Math.ceil((windowStart.getTime() + windowSec * 1000 - now) / 1000));
  return { ok: count < limit, count, retryAfter };
}

export function retryText(seconds: number) {
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "in a minute" : `in ${minutes} minutes`;
}
