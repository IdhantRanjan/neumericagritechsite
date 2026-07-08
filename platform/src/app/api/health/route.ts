/**
 * Health check — DB round-trip + build identity. Point an uptime monitor
 * (Vercel checks, UptimeRobot, Betterstack) at this; alert on non-200 or
 * db=false. Deliberately unauthenticated and cheap.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let dbOk = false;
  try {
    const db = await getDb();
    await db.run(sql`SELECT 1`);
    dbOk = true;
  } catch {
    // fall through — reported below
  }
  const body = {
    ok: dbOk,
    db: dbOk,
    dbMs: Date.now() - started,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    at: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
