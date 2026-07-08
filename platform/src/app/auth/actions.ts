"use server";

/**
 * Auth server actions. Magic link is the primary flow; password is an
 * optional fallback a user can add from /account. All flows are
 * rate-limited and logged to login_events.
 */
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, tables as t } from "@/db";
import {
  SESSION_COOKIE,
  createSession,
  findUserByEmail,
  getOrCreateUser,
  hashPassword,
  issueToken,
  logLoginEvent,
  requestMeta,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";
import { sendInvite, sendMagicLink } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";
import { OP_COOKIE, WS_COOKIE, requireOwner, requireAccess, actorOf, membershipFor } from "@/lib/current-op";
import { log } from "@/lib/log";

const emailSchema = z.string().trim().toLowerCase().email().max(200);
const now = () => new Date().toISOString();
const nid = (p: string) => `${p}_${randomBytes(6).toString("hex")}`;

// ————— Magic link —————

export async function requestMagicLink(
  _prev: unknown,
  formData: FormData
): Promise<{ ok?: string; error?: string; devLink?: string }> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };
  const email = parsed.data;

  const meta = await requestMeta();
  if (
    !(await rateLimit("magiclink_ip", meta.ip ?? "unknown", 10, 60)) ||
    !(await rateLimit("magiclink_email", email, 5, 60))
  ) {
    return { error: "Too many sign-in requests. Wait a bit and try again." };
  }

  // Don't reveal whether the account exists — same response either way.
  const user = await findUserByEmail(email);
  const token = await issueToken({ purpose: "magic_link", email, userId: user?.id ?? null });
  const sent = await sendMagicLink(email, token);
  await logLoginEvent("magic_link_sent", email, user?.id);

  if (!sent.sent && sent.reason === "no_provider")
    return {
      error:
        "Email delivery isn't configured on this deployment yet. Contact the Neumeric team to sign in.",
    };
  return {
    ok: "Check your email — the sign-in link works once and expires in 15 minutes.",
    devLink: sent.sent ? undefined : sent.devLink,
  };
}

// ————— Password fallback —————

export async function signInWithPassword(
  _prev: unknown,
  formData: FormData
): Promise<{ error?: string }> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  const password = String(formData.get("password") ?? "");
  if (!parsed.success || !password) return { error: "Enter your email and password." };
  const email = parsed.data;

  const meta = await requestMeta();
  if (!(await rateLimit("pw_ip", meta.ip ?? "unknown", 20, 60)) || !(await rateLimit("pw_email", email, 8, 60)))
    return { error: "Too many attempts. Wait a bit and try again." };

  const user = await findUserByEmail(email);
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    await logLoginEvent("password_failed", email, user?.id);
    return { error: "That email and password don't match. You can always use an email sign-in link instead." };
  }

  const token = await createSession(user.id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions());
  await logLoginEvent("signin", email, user.id);
  redirect("/");
}

export async function setPassword(_prev: unknown, formData: FormData): Promise<{ ok?: string; error?: string }> {
  const sess = await resolveSession();
  if (!sess) return { error: "Sign in first." };
  const password = String(formData.get("password") ?? "");
  if (password.length < 10) return { error: "Use at least 10 characters." };
  if (password.length > 200) return { error: "That's too long." };
  const db = await getDb();
  await db
    .update(t.users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(t.users.id, sess.user.id));
  await logLoginEvent("password_set", sess.user.email, sess.user.id);
  return { ok: "Password set. Magic links keep working too." };
}

// ————— Sign out —————

export async function signOut() {
  const sess = await resolveSession();
  if (sess) {
    await revokeSession(sess.session.id);
    await logLoginEvent("signout", sess.user.email, sess.user.id);
  }
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(OP_COOKIE);
  jar.delete(WS_COOKIE);
  redirect("/welcome");
}

export async function signOutEverywhere() {
  const sess = await resolveSession();
  if (sess) {
    await revokeAllSessions(sess.user.id);
    await logLoginEvent("signout_all", sess.user.email, sess.user.id);
  }
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(OP_COOKIE);
  redirect("/signin?signedout=all");
}

// ————— Operation switching (multi-farm users) —————

export async function switchOperation(operationId: string) {
  const a = await requireAccess();
  if (!a.user) return;
  const m = await membershipFor(a.user.id, operationId);
  if (!m) return;
  const jar = await cookies();
  jar.set(OP_COOKIE, operationId, sessionCookieOptions());
  redirect("/");
}

// ————— Members & invites (owner only) —————

const roleSchema = z.enum(["member", "advisor", "partner"]);

export async function inviteMember(
  _prev: unknown,
  formData: FormData
): Promise<{ ok?: string; error?: string; devLink?: string }> {
  const a = await requireOwner();
  const parsedEmail = emailSchema.safeParse(formData.get("email"));
  const parsedRole = roleSchema.safeParse(formData.get("role"));
  if (!parsedEmail.success || !parsedRole.success) return { error: "Enter a valid email and role." };
  if (!(await rateLimit("invite", a.op.id, 20, 24 * 60))) return { error: "Invite limit reached for today." };

  const existing = await findUserByEmail(parsedEmail.data);
  if (existing && (await membershipFor(existing.id, a.op.id)))
    return { error: "That person is already on this farm." };

  const token = await issueToken({
    purpose: "invite",
    email: parsedEmail.data,
    operationId: a.op.id,
    role: parsedRole.data,
    meta: { invitedBy: actorOf(a), operationName: a.op.name },
  });
  const sent = await sendInvite(parsedEmail.data, token, a.op.name, parsedRole.data);
  log.info("invite.sent", { op: a.op.id, role: parsedRole.data });

  if (!sent.sent && sent.reason === "no_provider")
    return { error: "Email delivery isn't configured yet — invites need RESEND_API_KEY (docs/DEPLOY.md)." };
  return {
    ok: `Invite sent to ${parsedEmail.data} as ${parsedRole.data}. It expires in 7 days.`,
    devLink: sent.sent ? undefined : sent.devLink,
  };
}

export async function removeMember(membershipId: string) {
  const a = await requireOwner();
  const db = await getDb();
  const m = (
    await db
      .select()
      .from(t.memberships)
      .where(and(eq(t.memberships.id, membershipId), eq(t.memberships.operationId, a.op.id)))
  )[0];
  if (!m) return;
  if (m.role === "owner") throw new Error("The owner can't be removed. Transfer ownership first.");
  await db.delete(t.memberships).where(eq(t.memberships.id, m.id));
  log.info("member.removed", { op: a.op.id, membership: m.id });
  revalidatePath("/settings");
}

// ————— Claim a legacy-link workspace into a real account —————

/**
 * A pre-auth pilot workspace (bearer link) adds an owner account by email:
 * we send a magic link; when it's consumed, verify creates the user, the
 * owner membership, and a session. From then on the account is
 * authoritative; the legacy link keeps working until the owner rotates it.
 */
export async function claimWorkspace(
  _prev: unknown,
  formData: FormData
): Promise<{ ok?: string; error?: string; devLink?: string }> {
  const a = await requireAccess();
  if (a.op.isDemo) return { error: "The demo can't be claimed — set up your own farm at /setup." };
  if (a.role !== "owner") return { error: "Only the farm owner can claim the account." };

  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };
  if (!(await rateLimit("claim", a.op.id, 5, 60))) return { error: "Too many attempts — try again later." };

  const token = await issueToken({
    purpose: "invite",
    email: parsed.data,
    operationId: a.op.id,
    role: "owner",
    meta: { claim: true, operationName: a.op.name },
  });
  const sent = await sendMagicLink(parsed.data, token); // magic-link wording fits the claim flow
  const db = await getDb();
  await db
    .update(t.operations)
    .set({ contactEmail: parsed.data })
    .where(eq(t.operations.id, a.op.id));

  if (!sent.sent && sent.reason === "no_provider")
    return { error: "Email delivery isn't configured yet (RESEND_API_KEY) — your private link keeps working meanwhile." };
  return {
    ok: `Sent a confirmation link to ${parsed.data}. Open it to finish attaching your account.`,
    devLink: sent.sent ? undefined : sent.devLink,
  };
}

/** Rotate the legacy bearer link (e.g. it leaked). Owner only. */
export async function rotateAccessLink() {
  const a = await requireOwner();
  const db = await getDb();
  const fresh = randomBytes(24).toString("base64url");
  await db.update(t.operations).set({ accessToken: fresh }).where(eq(t.operations.id, a.op.id));
  const jar = await cookies();
  // keep the current browser signed in through the new link if it was using the old one
  if (jar.get(WS_COOKIE)?.value) jar.set(WS_COOKIE, fresh, sessionCookieOptions());
  log.info("access_link.rotated", { op: a.op.id });
  revalidatePath("/settings");
}

// Ensure membership row exists when a signed-in user creates an operation
export async function ensureOwnerMembership(userId: string, operationId: string) {
  const db = await getDb();
  await db
    .insert(t.memberships)
    .values({ id: nid("mem"), userId, operationId, role: "owner", invitedBy: null, createdAt: now() })
    .onConflictDoNothing();
}
