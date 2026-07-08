/**
 * Authentication core — magic-link primary, optional password fallback.
 *
 * Design decisions that matter for security review:
 *  - Session + one-time tokens are 256-bit random values; the DB stores only
 *    sha256(token), so a database leak cannot mint or replay sessions.
 *  - Passwords are hashed with Node's built-in scrypt (N=16384, r=8, p=1,
 *    32-byte salt) and compared with timingSafeEqual. No native deps, no
 *    plaintext ever touches a log — password values are read once from the
 *    form and passed straight here.
 *  - Sessions are httpOnly + SameSite=Lax + Secure cookies, 30-day expiry,
 *    sliding lastSeenAt, revocable individually or all-at-once.
 *  - Every auth event lands in login_events (per-account audit log).
 */
import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb, tables as t } from "@/db";
import type { Session, User } from "@/db/schema";

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    _scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)))
  );

export const SESSION_COOKIE = "nmc_sess";
const SESSION_DAYS = 30;
const MAGIC_LINK_MINUTES = 15;
const INVITE_DAYS = 7;

const now = () => new Date().toISOString();
const nid = (p: string) => `${p}_${randomBytes(6).toString("hex")}`;
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

// ————— Password hashing (scrypt, built-in) —————

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(32);
  const key = (await scrypt(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  })) as Buffer;
  return `scrypt:${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${salt.toString("base64")}:${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const key = (await scrypt(password, salt, expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  })) as Buffer;
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// ————— Request context (ip / user-agent for the login log) —————

export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

export async function logLoginEvent(kind: string, email: string, userId?: string | null) {
  const db = await getDb();
  const meta = await requestMeta();
  await db.insert(t.loginEvents).values({
    id: nid("lev"),
    userId: userId ?? null,
    email: email.toLowerCase(),
    kind,
    ip: meta.ip,
    userAgent: meta.userAgent,
    at: now(),
  });
}

// ————— Users —————

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const db = await getDb();
  return (
    await db.select().from(t.users).where(eq(t.users.email, email.toLowerCase())).limit(1)
  )[0];
}

export async function getOrCreateUser(email: string, name?: string | null): Promise<User> {
  const db = await getDb();
  const existing = await findUserByEmail(email);
  if (existing) return existing;
  const user = {
    id: nid("usr"),
    email: email.toLowerCase(),
    name: name ?? null,
    passwordHash: null,
    emailVerifiedAt: null,
    createdAt: now(),
  };
  await db.insert(t.users).values(user);
  return user as User;
}

// ————— One-time tokens (magic link / invite / email change / waitlist) —————

export async function issueToken(opts: {
  purpose: "magic_link" | "invite" | "email_change" | "waitlist_confirm";
  email: string;
  userId?: string | null;
  operationId?: string | null;
  role?: string | null;
  meta?: Record<string, unknown>;
  ttlMinutes?: number;
}): Promise<string> {
  const db = await getDb();
  const token = newToken();
  const ttl =
    opts.ttlMinutes ??
    (opts.purpose === "magic_link" ? MAGIC_LINK_MINUTES : INVITE_DAYS * 24 * 60);
  await db.insert(t.authTokens).values({
    id: nid("tok"),
    purpose: opts.purpose,
    tokenHash: sha256(token),
    email: opts.email.toLowerCase(),
    userId: opts.userId ?? null,
    operationId: opts.operationId ?? null,
    role: opts.role ?? null,
    meta: opts.meta ?? null,
    expiresAt: new Date(Date.now() + ttl * 60_000).toISOString(),
    consumedAt: null,
    createdAt: now(),
  });
  return token;
}

/** Consume a one-time token: single use, purpose-bound, expiry-checked. */
export async function consumeToken(purpose: string, token: string) {
  const db = await getDb();
  const row = (
    await db
      .select()
      .from(t.authTokens)
      .where(
        and(
          eq(t.authTokens.tokenHash, sha256(token)),
          eq(t.authTokens.purpose, purpose),
          isNull(t.authTokens.consumedAt),
          gt(t.authTokens.expiresAt, now())
        )
      )
      .limit(1)
  )[0];
  if (!row) return null;
  await db
    .update(t.authTokens)
    .set({ consumedAt: now() })
    .where(eq(t.authTokens.id, row.id));
  return row;
}

// ————— Sessions —————

export async function createSession(userId: string): Promise<string> {
  const db = await getDb();
  const token = newToken();
  const meta = await requestMeta();
  await db.insert(t.sessions).values({
    id: nid("ses"),
    tokenHash: sha256(token),
    userId,
    createdAt: now(),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString(),
    lastSeenAt: now(),
    ip: meta.ip,
    userAgent: meta.userAgent,
    revokedAt: null,
  });
  return token;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
    path: "/",
  };
}

export async function resolveSession(): Promise<{ session: Session; user: User } | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const session = (
    await db
      .select()
      .from(t.sessions)
      .where(
        and(
          eq(t.sessions.tokenHash, sha256(token)),
          isNull(t.sessions.revokedAt),
          gt(t.sessions.expiresAt, now())
        )
      )
      .limit(1)
  )[0];
  if (!session) return null;
  const user = (await db.select().from(t.users).where(eq(t.users.id, session.userId)))[0];
  if (!user) return null;
  // sliding lastSeenAt, throttled to once an hour to avoid a write per request
  if (!session.lastSeenAt || Date.now() - Date.parse(session.lastSeenAt) > 3_600_000) {
    await db.update(t.sessions).set({ lastSeenAt: now() }).where(eq(t.sessions.id, session.id));
  }
  return { session, user };
}

export async function revokeSession(sessionId: string) {
  const db = await getDb();
  await db.update(t.sessions).set({ revokedAt: now() }).where(eq(t.sessions.id, sessionId));
}

export async function revokeAllSessions(userId: string) {
  const db = await getDb();
  await db
    .update(t.sessions)
    .set({ revokedAt: now() })
    .where(and(eq(t.sessions.userId, userId), isNull(t.sessions.revokedAt)));
}
