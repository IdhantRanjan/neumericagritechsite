/**
 * Workspace access — interim model until magic-link auth (ROADMAP Phase 1):
 * each operation has an unguessable access token; visiting /join/<token>
 * sets an HttpOnly cookie; every page resolves the operation from it and
 * every query is scoped to that operation. One farmer = one private link.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, tables as t } from "@/db";
import type { Operation } from "@/db/schema";

export const WS_COOKIE = "nmc_ws";

export async function currentOperation(): Promise<Operation | null> {
  const jar = await cookies();
  const token = jar.get(WS_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const rows = await db
    .select()
    .from(t.operations)
    .where(eq(t.operations.accessToken, token))
    .limit(1);
  return rows[0] ?? null;
}

/** Resolve the workspace or send the visitor to /welcome. */
export async function requireOperation(): Promise<Operation> {
  const op = await currentOperation();
  if (!op) redirect("/welcome");
  return op;
}
