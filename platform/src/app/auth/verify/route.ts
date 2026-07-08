/**
 * Token verification — the single landing point for magic links and invites.
 * Consumes the one-time token, creates/loads the user, materializes the
 * membership (for invites and workspace claims), verifies the email, and
 * opens a session.
 */
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, tables as t } from "@/db";
import {
  SESSION_COOKIE,
  consumeToken,
  createSession,
  getOrCreateUser,
  logLoginEvent,
  sessionCookieOptions,
} from "@/lib/auth";
import { OP_COOKIE } from "@/lib/current-op";
import { rateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/log";

const now = () => new Date().toISOString();
const nid = (p: string) => `${p}_${randomBytes(6).toString("hex")}`;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!token || !(await rateLimit("verify_ip", ip, 30, 60))) {
    return NextResponse.redirect(new URL("/signin?error=invalid", url.origin));
  }

  // one landing point, two purposes — try magic link first, then invite
  const row =
    (await consumeToken("magic_link", token)) ?? (await consumeToken("invite", token));
  if (!row) {
    return NextResponse.redirect(new URL("/signin?error=expired", url.origin));
  }

  const db = await getDb();
  const user = await getOrCreateUser(row.email);
  if (!user.emailVerifiedAt) {
    await db.update(t.users).set({ emailVerifiedAt: now() }).where(eq(t.users.id, user.id));
  }

  // invite / workspace claim → materialize the membership
  if (row.purpose === "invite" && row.operationId) {
    await db
      .insert(t.memberships)
      .values({
        id: nid("mem"),
        userId: user.id,
        operationId: row.operationId,
        role: row.role ?? "member",
        invitedBy: (row.meta as { invitedBy?: string } | null)?.invitedBy ?? null,
        createdAt: now(),
      })
      .onConflictDoNothing();
    await logLoginEvent("invite_accepted", row.email, user.id);
    log.info("invite.accepted", { op: row.operationId, role: row.role });
  }

  const sessionToken = await createSession(user.id);
  await logLoginEvent("signin", row.email, user.id);

  const res = NextResponse.redirect(
    new URL(row.purpose === "invite" ? "/?joined=1" : "/", url.origin)
  );
  res.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
  if (row.operationId) res.cookies.set(OP_COOKIE, row.operationId, sessionCookieOptions());
  return res;
}
