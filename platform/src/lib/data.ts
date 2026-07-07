/**
 * Read-side helpers. Everything is scoped to an operationId resolved from
 * the workspace cookie (lib/current-op.ts) — entity lookups verify ownership
 * before returning rows so one workspace can never read another's records.
 */
import { getDb, tables as t } from "@/db";
import { and, asc, eq, inArray } from "drizzle-orm";

export async function getFields(operationId: string) {
  const db = await getDb();
  return db.select().from(t.fields).where(eq(t.fields.operationId, operationId));
}

/** Field lookup that enforces workspace ownership. */
export async function getField(id: string, operationId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(t.fields)
    .where(and(eq(t.fields.id, id), eq(t.fields.operationId, operationId)));
  return rows[0];
}

export async function getSeasonsByField(fieldId: string) {
  const db = await getDb();
  return db.select().from(t.cropSeasons).where(eq(t.cropSeasons.fieldId, fieldId));
}

export async function getSeasonsForOperation(operationId: string) {
  const db = await getDb();
  const flds = await getFields(operationId);
  if (flds.length === 0) return [];
  return db
    .select()
    .from(t.cropSeasons)
    .where(inArray(t.cropSeasons.fieldId, flds.map((f) => f.id)));
}

export async function getDeadlines(operationId: string) {
  const db = await getDb();
  return db
    .select()
    .from(t.deadlineInstances)
    .where(eq(t.deadlineInstances.operationId, operationId))
    .orderBy(asc(t.deadlineInstances.dueDate));
}

export async function getClaims(operationId: string) {
  const db = await getDb();
  return db.select().from(t.claims).where(eq(t.claims.operationId, operationId));
}

export async function getClaim(id: string, operationId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(t.claims)
    .where(and(eq(t.claims.id, id), eq(t.claims.operationId, operationId)));
  return rows[0];
}

export async function getPolicyRef(id: string) {
  const db = await getDb();
  return (await db.select().from(t.policyRefs).where(eq(t.policyRefs.id, id)))[0];
}

export async function getCapturesByField(fieldId: string) {
  const db = await getDb();
  return db
    .select()
    .from(t.imageryCaptures)
    .where(eq(t.imageryCaptures.fieldId, fieldId))
    .orderBy(asc(t.imageryCaptures.capturedAt));
}

export async function getFcr(id: string) {
  const db = await getDb();
  return (
    await db.select().from(t.fieldConditionRecords).where(eq(t.fieldConditionRecords.id, id))
  )[0];
}

export async function getFcrsByField(fieldId: string) {
  const db = await getDb();
  return db
    .select()
    .from(t.fieldConditionRecords)
    .where(eq(t.fieldConditionRecords.fieldId, fieldId));
}

export async function getProgramMatches(operationId: string) {
  const db = await getDb();
  return db
    .select()
    .from(t.programMatches)
    .where(eq(t.programMatches.operationId, operationId));
}

export async function getMarketingPositions(operationId: string) {
  const db = await getDb();
  return db
    .select()
    .from(t.marketingPositions)
    .where(eq(t.marketingPositions.operationId, operationId));
}

export async function getPlanTargets(positionId: string) {
  const db = await getDb();
  return db
    .select()
    .from(t.marketingPlanTargets)
    .where(eq(t.marketingPlanTargets.positionId, positionId))
    .orderBy(asc(t.marketingPlanTargets.createdAt));
}
