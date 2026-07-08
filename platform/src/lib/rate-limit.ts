/**
 * Fixed-window rate limiting backed by the database, so it holds across
 * serverless instances (in-memory counters don't on Vercel). Windows are
 * coarse (per hour/minute bucket in the key) — right-sized for abuse
 * protection on public endpoints, not for precise QoS.
 */
import { eq, lt, sql } from "drizzle-orm";
import { getDb, tables as t } from "@/db";
import { log } from "@/lib/log";

/**
 * Returns true if the call is allowed. `scope` names the endpoint,
 * `subject` identifies the caller (ip or email), `limit` is max calls per
 * `windowMinutes` window.
 */
export async function rateLimit(
  scope: string,
  subject: string,
  limit: number,
  windowMinutes: number
): Promise<boolean> {
  const db = await getDb();
  const bucket = Math.floor(Date.now() / (windowMinutes * 60_000));
  const key = `${scope}:${subject}:${bucket}`;
  const nowIso = new Date().toISOString();

  await db
    .insert(t.rateLimits)
    .values({ key, count: 1, windowStart: nowIso })
    .onConflictDoUpdate({
      target: t.rateLimits.key,
      set: { count: sql`${t.rateLimits.count} + 1` },
    });
  const row = (await db.select().from(t.rateLimits).where(eq(t.rateLimits.key, key)))[0];

  // opportunistic cleanup of stale windows (~1% of calls)
  if (Math.random() < 0.01) {
    try {
      const cutoff = new Date(Date.now() - 24 * 3_600_000).toISOString();
      await db.delete(t.rateLimits).where(lt(t.rateLimits.windowStart, cutoff));
    } catch {
      // cleanup is best-effort
    }
  }

  const allowed = (row?.count ?? 1) <= limit;
  if (!allowed) log.warn("rate_limit.blocked", { scope, subject: subject.slice(0, 60) });
  return allowed;
}
