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

export async function getSceneObservations(fieldId: string) {
  const db = await getDb();
  return db
    .select()
    .from(t.sceneObservations)
    .where(eq(t.sceneObservations.fieldId, fieldId))
    .orderBy(asc(t.sceneObservations.acquiredAt));
}

export async function getTriggerEvaluations(fieldId: string) {
  const db = await getDb();
  const defs = await db
    .select()
    .from(t.triggerDefinitions)
    .where(eq(t.triggerDefinitions.fieldId, fieldId));
  if (defs.length === 0) return [];
  const evals = await db
    .select()
    .from(t.triggerEvaluations)
    .where(inArray(t.triggerEvaluations.triggerDefinitionId, defs.map((d) => d.id)));
  return evals.sort((a, b) => (a.evaluatedAt > b.evaluatedAt ? -1 : 1));
}

export async function getLabelsForClaim(claimId: string) {
  const db = await getDb();
  return db.select().from(t.groundTruthLabels).where(eq(t.groundTruthLabels.claimId, claimId));
}

export async function getLatestAuditFor(entityType: string, entityId: string, action: string) {
  const db = await getDb();
  const rows = await db.select().from(t.auditEvents).where(eq(t.auditEvents.entityType, entityType));
  return rows
    .filter((r) => r.action === action && (r.detail as { reason?: string } | null) && r.entityId === entityId)
    .sort((a, b) => (a.at > b.at ? -1 : 1))[0];
}
