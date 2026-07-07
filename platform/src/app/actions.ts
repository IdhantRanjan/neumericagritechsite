"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { getDb, tables as t } from "@/db";
import { demoAnalyzer } from "@/lib/cv/demo-analyzer";
import { applicableRules } from "@/lib/rules/deadlines";
import { matchPrograms, type OperationProfile } from "@/lib/rules/programs";
import { requireOperation, WS_COOKIE } from "@/lib/current-op";

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;

async function audit(actor: string, action: string, entityType: string, entityId: string, detail?: Record<string, unknown>) {
  const db = await getDb();
  await db
    .insert(t.auditEvents)
    .values({ id: id("aud"), actor, action, entityType, entityId, detail, at: now() });
}

// ————— Onboarding: real farms —————

const VALID_CROPS = new Set(["corn", "soybeans", "wheat", "oats", "sorghum", "other"]);

export async function createOperation(formData: FormData) {
  const db = await getDb();
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const state = String(formData.get("state") ?? "").trim().toUpperCase().slice(0, 2);
  const counties = String(formData.get("counties") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 12);
  const email = String(formData.get("email") ?? "").trim().slice(0, 200) || null;
  if (!name || !/^[A-Z]{2}$/.test(state) || counties.length === 0) {
    throw new Error("Operation name, state, and at least one county are required.");
  }

  const opId = id("op");
  const accessToken = randomBytes(24).toString("base64url");
  await db.insert(t.operations).values({
    id: opId,
    name,
    state,
    counties,
    entityType: String(formData.get("entityType") ?? "sole_proprietor"),
    isDemo: false,
    accessToken,
    contactEmail: email,
    hasBaseAcres: formData.get("hasBaseAcres") === "on",
    storesGrainOnFarm: formData.get("storesGrainOnFarm") === "on",
    usesCoverCrops: formData.get("usesCoverCrops") === "on",
    usesNoTill: formData.get("usesNoTill") === "on",
    createdAt: now(),
  });

  // Fields arrive as parallel arrays from the dynamic form rows
  const names = formData.getAll("fieldName").map(String);
  const fieldCounties = formData.getAll("fieldCounty").map(String);
  const acres = formData.getAll("fieldAcres").map(Number);
  const crops = formData.getAll("fieldCrop").map(String);
  const fsaFarms = formData.getAll("fieldFsaFarm").map(String);
  const year = new Date().getFullYear();
  const grownCrops = new Set<string>();

  for (let i = 0; i < names.length; i++) {
    const fname = names[i].trim().slice(0, 120);
    const facres = acres[i];
    if (!fname || !Number.isFinite(facres) || facres <= 0 || facres > 100_000) continue;
    const fieldId = id("fld");
    await db.insert(t.fields).values({
      id: fieldId,
      operationId: opId,
      name: fname,
      county: (fieldCounties[i] || counties[0]).trim().slice(0, 80),
      acres: facres,
      boundary: null, // Phase 1: boundary drawing / FSA CLU import
      fsaFarmNumber: fsaFarms[i]?.trim().slice(0, 20) || null,
      fsaTractNumber: null,
      fsaFieldNumber: null,
    });
    const crop = VALID_CROPS.has(crops[i]) ? crops[i] : null;
    if (crop && crop !== "other") {
      grownCrops.add(crop);
      await db.insert(t.cropSeasons).values({
        id: id("cs"),
        fieldId,
        crop,
        year,
        practice: "non_irrigated",
        plantingDate: null,
        intendedAcres: facres,
        reportedAcres: null,
      });
    }
  }

  // Materialize deadlines from the rules layer for this state/crops
  for (const rule of applicableRules(state, year, [...grownCrops])) {
    await db.insert(t.deadlineInstances).values({
      id: id("dl"),
      operationId: opId,
      ruleId: rule.id,
      crop: rule.crops.join(" + "),
      dueDate: rule.date!,
      status: new Date(rule.date! + "T23:59:59") < new Date() ? "missed" : "upcoming",
      completedAt: null,
    });
  }

  // Program matches from the profile
  const profile: OperationProfile = {
    state,
    crops: [...grownCrops],
    hasBaseAcres: formData.get("hasBaseAcres") === "on",
    storesGrainOnFarm: formData.get("storesGrainOnFarm") === "on",
    usesCoverCrops: formData.get("usesCoverCrops") === "on",
    usesNoTill: formData.get("usesNoTill") === "on",
    hasDocumentedLoss: false,
    filedAcreageReport: false,
  };
  for (const m of matchPrograms(profile)) {
    await db.insert(t.programMatches).values({
      id: id("pm"),
      operationId: opId,
      programId: m.program.id,
      matchedCriteria: m.matched,
      missingCriteria: m.missing,
      strength: m.strength,
      status: "new",
      evaluatedAt: now(),
    });
  }

  await audit("onboarding", "operation_created", "operation", opId, { state, fields: names.length });

  const jar = await cookies();
  jar.set(WS_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  redirect("/settings?created=1");
}

export async function leaveWorkspace() {
  const jar = await cookies();
  jar.delete(WS_COOKIE);
  redirect("/welcome");
}

// ————— Pillar 1 —————

export async function markDeadlineDone(deadlineId: string) {
  const op = await requireOperation();
  const db = await getDb();
  await db
    .update(t.deadlineInstances)
    .set({ status: "done", completedAt: now() })
    .where(and(eq(t.deadlineInstances.id, deadlineId), eq(t.deadlineInstances.operationId, op.id)));
  await audit(op.id, "deadline_marked_done", "deadline_instance", deadlineId);
  revalidatePath("/deadlines");
  revalidatePath("/");
}

export async function setProgramStatus(matchId: string, status: string) {
  if (!["new", "pursuing", "dismissed", "received"].includes(status)) return;
  const op = await requireOperation();
  const db = await getDb();
  await db
    .update(t.programMatches)
    .set({ status })
    .where(and(eq(t.programMatches.id, matchId), eq(t.programMatches.operationId, op.id)));
  await audit(op.id, "program_match_status", "program_match", matchId, { status });
  revalidatePath("/programs");
}

export async function createClaim(formData: FormData) {
  const op = await requireOperation();
  const db = await getDb();
  const fieldId = String(formData.get("fieldId"));
  const damageType = String(formData.get("damageType"));
  const eventDate = String(formData.get("eventDate"));
  const narrative = String(formData.get("narrative") ?? "").slice(0, 4000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw new Error("Invalid event date");

  const field = (
    await db.select().from(t.fields).where(and(eq(t.fields.id, fieldId), eq(t.fields.operationId, op.id)))
  )[0];
  if (!field) throw new Error("Unknown field");
  const seasons = await db.select().from(t.cropSeasons).where(eq(t.cropSeasons.fieldId, fieldId));
  const season = seasons.find((s) => s.year === new Date(eventDate).getUTCFullYear());

  const claimId = id("clm");
  await db.insert(t.claims).values({
    id: claimId,
    operationId: op.id,
    fieldId,
    cropSeasonId: season?.id ?? null,
    policyRefId: null,
    damageType,
    eventDate,
    discoveredDate: eventDate,
    narrative,
    status: "draft",
    fcrIds: [],
    createdAt: now(),
  });
  await audit(op.id, "claim_created", "claim", claimId, { fieldId, damageType, eventDate });
  redirect(`/claims/${claimId}`);
}

/**
 * Ingest evidence for a claim and run the analysis pipeline
 * (ingest → hash → capture record → analyzer → FCR with provenance).
 */
export async function addEvidence(claimId: string, formData: FormData) {
  const op = await requireOperation();
  const db = await getDb();
  const claim = (
    await db.select().from(t.claims).where(and(eq(t.claims.id, claimId), eq(t.claims.operationId, op.id)))
  )[0];
  if (!claim) throw new Error("Unknown claim");
  const field = (await db.select().from(t.fields).where(eq(t.fields.id, claim.fieldId)))[0];

  const file = formData.get("photo") as File | null;
  const captureId = id("cap");
  let fileName: string;
  let sha256: string;
  let bytes: number;

  if (file && file.size > 0) {
    if (file.size > 25_000_000) throw new Error("Photo too large (25 MB max)");
    const buf = Buffer.from(await file.arrayBuffer());
    sha256 = createHash("sha256").update(buf).digest("hex");
    bytes = buf.length;
    fileName = file.name.replace(/[^\w.\-]/g, "_").slice(0, 140);
    // Serverless: /tmp (set UPLOAD_DIR) until durable object storage (S3/R2)
    // lands — the sha256 in the capture record is the permanent integrity anchor
    const dir = process.env.UPLOAD_DIR ?? path.join(process.cwd(), ".data", "uploads");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, sha256), buf);
  } else {
    fileName = `sample_${claim.damageType}_${captureId}.jpg`;
    sha256 = createHash("sha256").update("sample:" + captureId).digest("hex");
    bytes = 3_800_000;
  }

  await db.insert(t.imageryCaptures).values({
    id: captureId,
    fieldId: claim.fieldId,
    source: "phone",
    capturedAt: now(),
    lat: null, // Phase 1: guided capture flow enforces GPS + timestamp
    lng: null,
    fileName,
    sha256,
    bytes,
    uploadedBy: op.id,
    uploadedAt: now(),
    metadata: file && file.size > 0 ? { origin: "upload" } : { origin: "synthesized sample" },
  });
  await audit(op.id, "imagery_ingested", "imagery_capture", captureId, { claimId, sha256 });

  const captures = await db
    .select()
    .from(t.imageryCaptures)
    .where(eq(t.imageryCaptures.fieldId, claim.fieldId));
  const season = claim.cropSeasonId
    ? (await db.select().from(t.cropSeasons).where(eq(t.cropSeasons.id, claim.cropSeasonId)))[0]
    : undefined;

  const out = await demoAnalyzer.analyze({
    fieldId: claim.fieldId,
    crop: season?.crop ?? "corn",
    damageType: claim.damageType,
    eventDate: claim.eventDate,
    captures: captures.map((c) => ({
      id: c.id,
      source: c.source as "phone" | "drone" | "satellite",
      capturedAt: c.capturedAt,
      sha256: c.sha256,
      fileName: c.fileName,
    })),
    fieldAcres: field.acres,
  });

  const fcrId = id("fcr");
  await db.insert(t.fieldConditionRecords).values({
    id: fcrId,
    fieldId: claim.fieldId,
    cropSeasonId: claim.cropSeasonId,
    observedAt: now(),
    crop: season?.crop ?? "corn",
    growthStage: out.growthStage,
    conditionClass: out.conditionClass,
    damageType: claim.damageType,
    severityPct: out.severityPct,
    affectedAcres: out.affectedAcres,
    affectedArea: null,
    metrics: out.metrics,
    confidence: out.confidence,
    captureIds: captures.map((c) => c.id),
    imagerySha256: captures.map((c) => c.sha256),
    modelName: demoAnalyzer.name,
    modelVersion: demoAnalyzer.version,
    pipelineRunId: id("run"),
    analyzedAt: now(),
    reviewedBy: null,
    supersedes: claim.fcrIds.at(-1) ?? null,
  });
  await audit(op.id, "fcr_emitted", "field_condition_record", fcrId, {
    claimId,
    model: `${demoAnalyzer.name}@${demoAnalyzer.version}`,
  });

  await db
    .update(t.claims)
    .set({ status: "evidence", fcrIds: [...claim.fcrIds, fcrId] })
    .where(eq(t.claims.id, claimId));

  revalidatePath(`/claims/${claimId}`);
  revalidatePath("/claims");
  revalidatePath("/");
}

/** Human-review sign-off — Phase 1 gate before a packet is shareable. */
export async function markFcrReviewed(fcrId: string, claimId: string) {
  const op = await requireOperation();
  const db = await getDb();
  const claim = (
    await db.select().from(t.claims).where(and(eq(t.claims.id, claimId), eq(t.claims.operationId, op.id)))
  )[0];
  if (!claim || !claim.fcrIds.includes(fcrId)) throw new Error("Unknown claim/record");
  await db
    .update(t.fieldConditionRecords)
    .set({ reviewedBy: "workspace-owner" })
    .where(eq(t.fieldConditionRecords.id, fcrId));
  await db.update(t.claims).set({ status: "packet_ready" }).where(eq(t.claims.id, claimId));
  await audit(op.id, "fcr_reviewed", "field_condition_record", fcrId, { claimId });
  revalidatePath(`/claims/${claimId}`);
  revalidatePath("/claims");
}

// ————— Pillar 3: marketing position (decision support only) —————

const num = (formData: FormData, key: string): number | null => {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

export async function saveMarketingPosition(formData: FormData) {
  const op = await requireOperation();
  const db = await getDb();
  const crop = String(formData.get("crop") ?? "corn");
  const year = Number(formData.get("year") ?? new Date().getFullYear());

  const values = {
    operationId: op.id,
    crop,
    year,
    acres: num(formData, "acres"),
    expectedYieldBuPerAcre: num(formData, "expectedYield"),
    producedBu: num(formData, "producedBu"),
    storedBu: num(formData, "storedBu"),
    soldBu: num(formData, "soldBu"),
    avgSoldPrice: num(formData, "avgSoldPrice"),
    contractedBu: num(formData, "contractedBu"),
    costOfProductionPerAcre: num(formData, "costPerAcre"),
    insuranceFloorPerBu: num(formData, "insuranceFloor"),
    currentCashPrice: num(formData, "cashPrice"),
    currentFuturesPrice: num(formData, "futuresPrice"),
    typicalBasisLo: num(formData, "basisLo"),
    typicalBasisHi: num(formData, "basisHi"),
    storageCapacityBu: num(formData, "storageCapacity"),
    storageCostPerBuMonth: num(formData, "storageCost"),
    cashNeedUsd: num(formData, "cashNeed"),
    cashNeedByDate: String(formData.get("cashNeedBy") ?? "") || null,
    updatedAt: now(),
  };

  const existing = (
    await db
      .select()
      .from(t.marketingPositions)
      .where(
        and(
          eq(t.marketingPositions.operationId, op.id),
          eq(t.marketingPositions.crop, crop),
          eq(t.marketingPositions.year, year)
        )
      )
  )[0];

  if (existing) {
    await db.update(t.marketingPositions).set(values).where(eq(t.marketingPositions.id, existing.id));
    await audit(op.id, "marketing_position_updated", "marketing_position", existing.id);
  } else {
    const pid = id("mkt");
    await db.insert(t.marketingPositions).values({ id: pid, ...values });
    await audit(op.id, "marketing_position_created", "marketing_position", pid);
  }
  revalidatePath("/marketing");
  revalidatePath("/");
}

export async function addPlanTarget(positionId: string, formData: FormData) {
  const op = await requireOperation();
  const db = await getDb();
  const pos = (
    await db
      .select()
      .from(t.marketingPositions)
      .where(and(eq(t.marketingPositions.id, positionId), eq(t.marketingPositions.operationId, op.id)))
  )[0];
  if (!pos) throw new Error("Unknown position");
  const kind = String(formData.get("kind"));
  const targetValue = num(formData, "targetValue");
  const amountBu = num(formData, "amountBu");
  if (!["cash_price", "basis"].includes(kind) || targetValue == null || !amountBu || amountBu <= 0)
    return;
  const tid = id("tgt");
  await db.insert(t.marketingPlanTargets).values({
    id: tid,
    positionId,
    kind,
    targetValue,
    amountBu,
    note: String(formData.get("note") ?? "").slice(0, 500) || null,
    status: "waiting",
    createdAt: now(),
  });
  await audit(op.id, "plan_target_added", "marketing_plan_target", tid, { kind, targetValue });
  revalidatePath("/marketing");
}

export async function setTargetStatus(targetId: string, status: string) {
  if (!["waiting", "acted", "dropped"].includes(status)) return;
  const op = await requireOperation();
  const db = await getDb();
  const target = (
    await db.select().from(t.marketingPlanTargets).where(eq(t.marketingPlanTargets.id, targetId))
  )[0];
  if (!target) return;
  const pos = (
    await db
      .select()
      .from(t.marketingPositions)
      .where(and(eq(t.marketingPositions.id, target.positionId), eq(t.marketingPositions.operationId, op.id)))
  )[0];
  if (!pos) return;
  await db.update(t.marketingPlanTargets).set({ status }).where(eq(t.marketingPlanTargets.id, targetId));
  await audit(op.id, "plan_target_status", "marketing_plan_target", targetId, { status });
  revalidatePath("/marketing");
}
