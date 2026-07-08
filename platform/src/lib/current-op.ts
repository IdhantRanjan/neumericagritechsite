/**
 * Access control — who is signed in, which operation they're acting on,
 * and what their role lets them do.
 *
 * Resolution order:
 *  1. Real session (nmc_sess cookie → sessions table → user) + operation
 *     selection (nmc_op cookie, validated against a membership row).
 *  2. Legacy workspace bearer link (nmc_ws cookie → operations.accessToken).
 *     Pre-auth pilot workspaces keep working; their role is "owner" until
 *     the owner claims the account by email (settings → claim), after which
 *     the membership row is authoritative. The public demo resolves through
 *     this path too, as role "visitor".
 *
 * Role model (docs/ARCHITECTURE.md §Access):
 *  owner   — full control: settings, members, everything below
 *  member  — day-to-day writes: claims, evidence, marketing, deadlines
 *  advisor — read everything, record ground-truth outcomes, nothing else
 *  partner — reserved lender/co-op channel: read-only, tenant-isolated
 *  visitor — the public demo: read-only
 *
 * Every mutation calls requireWrite()/requireOwner(); every page calls
 * requireAccess()/requireOperation(). The demo operation is read-only for
 * everyone — visitors can look, never corrupt.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, tables as t } from "@/db";
import { resolveSession } from "@/lib/auth";
import type { Membership, Operation, User } from "@/db/schema";

export const WS_COOKIE = "nmc_ws"; // legacy bearer link + demo
export const OP_COOKIE = "nmc_op"; // which operation a signed-in user is acting on

export type Role = "owner" | "member" | "advisor" | "partner" | "visitor";

export type Access = {
  op: Operation;
  role: Role;
  user: User | null; // null on legacy-link / demo access
  memberships: Membership[]; // all of the user's operations (for switching)
};

const WRITE_ROLES: Role[] = ["owner", "member"];

export function canWrite(a: Access): boolean {
  return !a.op.isDemo && WRITE_ROLES.includes(a.role);
}
export function canManage(a: Access): boolean {
  return !a.op.isDemo && a.role === "owner";
}
/** Advisors may record confirmed real-world outcomes (ground truth). */
export function canRecordOutcome(a: Access): boolean {
  return !a.op.isDemo && ["owner", "member", "advisor"].includes(a.role);
}

async function opById(opId: string): Promise<Operation | null> {
  const db = await getDb();
  return (await db.select().from(t.operations).where(eq(t.operations.id, opId)))[0] ?? null;
}

export async function currentAccess(): Promise<Access | null> {
  const jar = await cookies();
  const db = await getDb();

  // 1) real session
  const sess = await resolveSession();
  if (sess) {
    const members = await db
      .select()
      .from(t.memberships)
      .where(eq(t.memberships.userId, sess.user.id));
    if (members.length > 0) {
      const wanted = jar.get(OP_COOKIE)?.value;
      const m = members.find((x) => x.operationId === wanted) ?? members[0];
      const op = await opById(m.operationId);
      if (op) return { op, role: m.role as Role, user: sess.user, memberships: members };
    }
    // signed in but no farm yet — fall through so a demo cookie still works
  }

  // 2) legacy bearer link / demo
  const token = jar.get(WS_COOKIE)?.value;
  if (token) {
    const op = (
      await db.select().from(t.operations).where(eq(t.operations.accessToken, token)).limit(1)
    )[0];
    if (op) {
      return {
        op,
        role: op.isDemo ? "visitor" : "owner",
        user: sess?.user ?? null,
        memberships: [],
      };
    }
  }

  return null;
}

/** Access or /welcome. */
export async function requireAccess(): Promise<Access> {
  const a = await currentAccess();
  if (!a) redirect("/welcome");
  return a;
}

/** Write-capable access or a friendly error (server actions surface it). */
export async function requireWrite(): Promise<Access> {
  const a = await requireAccess();
  if (a.op.isDemo)
    throw new Error(
      "The demo is read-only sample data. Set up your own farm at /setup to make changes."
    );
  if (!canWrite(a))
    throw new Error(
      `Your role (${a.role}) can view this farm but not change it. Ask the farm owner for member access.`
    );
  return a;
}

/** Owner-only (settings, members, invites). */
export async function requireOwner(): Promise<Access> {
  const a = await requireAccess();
  if (a.op.isDemo) throw new Error("The demo is read-only sample data.");
  if (!canManage(a)) throw new Error("Only the farm owner can do this.");
  return a;
}

// ————— Back-compat surface (pages/layouts that only need the operation) —————

export async function currentOperation(): Promise<Operation | null> {
  return (await currentAccess())?.op ?? null;
}

export async function requireOperation(): Promise<Operation> {
  return (await requireAccess()).op;
}

/** Actor string for audit rows: user id when known, else operation id. */
export function actorOf(a: Access): string {
  return a.user ? `${a.user.id}:${a.role}` : `${a.op.id}:legacy`;
}

/** Membership lookup used by invite acceptance & isolation tests. */
export async function membershipFor(
  userId: string,
  operationId: string
): Promise<Membership | null> {
  const db = await getDb();
  return (
    (
      await db
        .select()
        .from(t.memberships)
        .where(and(eq(t.memberships.userId, userId), eq(t.memberships.operationId, operationId)))
    )[0] ?? null
  );
}
