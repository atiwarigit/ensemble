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

const openWindow = (key: string, windowSec: number, now: number) =>
  sql`select window_start from ${rateLimits} where key = ${key} and window_start > ${new Date(now - windowSec * 1000).toISOString()} order by window_start desc limit 1`;

const retryAfterSec = (windowStart: Date | string, windowSec: number, now: number) =>
  Math.max(1, Math.ceil((new Date(windowStart).getTime() + windowSec * 1000 - now) / 1000));

/**
 * Counter in Postgres, so limits hold across serverless instances. A window opens at the first
 * attempt (not on a clock boundary, which would let a burst straddle two windows) and lasts
 * windowSec. Counts the attempt and reports whether it's within the limit.
 */
export async function hitRateLimit(key: string, { limit, windowSec }: RateLimit, now = Date.now()) {
  const rows = await db.execute<{ window_start: string; count: number }>(sql`
    insert into ${rateLimits} (key, window_start, count)
    values (${key}, coalesce((${openWindow(key, windowSec, now)}), ${new Date(now).toISOString()}::timestamptz), 1)
    on conflict (key, window_start) do update set count = ${rateLimits}.count + 1
    returning window_start, count`);
  const row = rows[0];
  return { ok: row.count <= limit, count: row.count, retryAfter: retryAfterSec(row.window_start, windowSec, now) };
}

/** Reads the open window's count without counting an attempt (for failure-only limits). */
export async function peekRateLimit(key: string, { limit, windowSec }: RateLimit, now = Date.now()) {
  const rows = await db.execute<{ window_start: string; count: number }>(
    sql`select window_start, count from ${rateLimits} where key = ${key} and window_start > ${new Date(now - windowSec * 1000).toISOString()} order by window_start desc limit 1`,
  );
  const row = rows[0];
  if (!row) return { ok: true, count: 0, retryAfter: 0 };
  return { ok: row.count < limit, count: row.count, retryAfter: retryAfterSec(row.window_start, windowSec, now) };
}

export function retryText(seconds: number) {
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "in a minute" : `in ${minutes} minutes`;
}
