/** Double-opt-in confirmation — flips a pending signup to confirmed. */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, tables as t } from "@/db";
import { consumeToken } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/log";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await rateLimit("waitlist_confirm", ip, 20, 60))) {
    return NextResponse.redirect(new URL("/welcome", url.origin));
  }
  const token = url.searchParams.get("token") ?? "";
  const row = token ? await consumeToken("waitlist_confirm", token) : null;
  if (!row) {
    return NextResponse.redirect(new URL("/welcome?invalid=1", url.origin));
  }
  const db = await getDb();
  await db
    .update(t.waitlistSignups)
    .set({ status: "confirmed", confirmedAt: new Date().toISOString() })
    .where(eq(t.waitlistSignups.email, row.email));
  log.info("waitlist.confirmed", {});
  return NextResponse.redirect(new URL("/welcome?waitlist=confirmed", url.origin));
}
