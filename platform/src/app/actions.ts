"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, tables as t } from "@/db";
import { demoAnalyzer } from "@/lib/cv/demo-analyzer";
import { primaryModelFor } from "@/lib/cv/registry";
import { applicableRules } from "@/lib/rules/deadlines";
import { matchPrograms, type OperationProfile } from "@/lib/rules/programs";
import { requireWrite, requireAccess, canRecordOutcome, WS_COOKIE, OP_COOKIE } from "@/lib/current-op";
import { resolveSession } from "@/lib/auth";
import { scanField } from "@/lib/satellite/scan";
import { cdlComposition } from "@/lib/satellite/cdl";
import { ringAcres, ringToUtm, epsgForLngLat, approxRectBoundary } from "@/lib/satellite/geo";
import { appendProvenance } from "@/lib/provenance";
import { putObject } from "@/lib/storage";
import { createJob, runJob } from "@/lib/jobs";
import {
  defaultDroughtStressMethodology,
  evaluateTrigger,
  evaluateWeatherCounterpart,
  basisRiskGap,
  methodologyHash,
} from "@/lib/parametric";
import type { GeoJSONPolygon } from "@/db/schema";

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

  // funnel: waitlist signup with this email is now onboarded
  if (email) {
    await db
      .update(t.waitlistSignups)
      .set({ status: "onboarded", onboardedOperationId: opId })
      .where(eq(t.waitlistSignups.email, email.toLowerCase()));
  }

  // Signed-in user creating a farm → owner membership (account-first path).
  // Anonymous setup keeps the legacy private link and can claim later.
  const sess = await resolveSession();
  if (sess) {
    await db
      .insert(t.memberships)
      .values({
        id: id("mem"),
        userId: sess.user.id,
        operationId: opId,
        role: "owner",
        invitedBy: null,
        createdAt: now(),
      })
      .onConflictDoNothing();
  }

  const cookieOpts = {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  };
  const jar = await cookies();
  if (sess) jar.set(OP_COOKIE, opId, cookieOpts);
  jar.set(WS_COOKIE, accessToken, cookieOpts);
  redirect("/settings?created=1");
}

export async function leaveWorkspace() {
  const jar = await cookies();
  jar.delete(WS_COOKIE);
  jar.delete(OP_COOKIE);
  redirect("/welcome");
}

// ————— Pillar 1 —————

export async function markDeadlineDone(deadlineId: string) {
  const { op } = await requireWrite();
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
  const { op } = await requireWrite();
  const db = await getDb();
  await db
    .update(t.programMatches)
    .set({ status })
    .where(and(eq(t.programMatches.id, matchId), eq(t.programMatches.operationId, op.id)));
  await audit(op.id, "program_match_status", "program_match", matchId, { status });
  revalidatePath("/programs");
}

export async function createClaim(formData: FormData) {
  const { op } = await requireWrite();
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
  const { op } = await requireWrite();
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

  let storageUrl: string | null = null;
  let storageBackend: string = "local";
  if (file && file.size > 0) {
    if (file.size > 25_000_000) throw new Error("Photo too large (25 MB max)");
    const buf = Buffer.from(await file.arrayBuffer());
    sha256 = createHash("sha256").update(buf).digest("hex");
    bytes = buf.length;
    fileName = file.name.replace(/[^\w.\-]/g, "_").slice(0, 140);
    // content-addressed durable storage: the sha256 IS the storage key
    const stored = await putObject(sha256, buf, file.type || "image/jpeg");
    storageUrl = stored.url;
    storageBackend = stored.backend;
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
    storageUrl,
    storageBackend,
    uploadedBy: op.id,
    uploadedAt: now(),
    metadata: file && file.size > 0 ? { origin: "upload" } : { origin: "synthesized sample" },
  });
  await appendProvenance(db, "imagery_capture", captureId, "ingested", {
    claimId,
    fieldId: claim.fieldId,
    sha256,
    bytes,
    fileName,
    storageBackend,
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
  await appendProvenance(db, "field_condition_record", fcrId, "emitted", {
    claimId,
    model: `${demoAnalyzer.name}@${demoAnalyzer.version}`,
    severityPct: out.severityPct,
    affectedAcres: out.affectedAcres,
    metrics: out.metrics,
    imagerySha256: captures.map((c) => c.sha256),
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
  const { op } = await requireWrite();
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

/** Server-side bounds — never trust client input on money-adjacent numbers. */
const numBounded = (
  formData: FormData,
  key: string,
  min: number,
  max: number
): number | null => {
  const n = num(formData, key);
  if (n == null) return null;
  if (n < min || n > max) throw new Error(`"${key}" is out of range (${min}–${max}).`);
  return n;
};

export async function saveMarketingPosition(formData: FormData) {
  const { op } = await requireWrite();
  const db = await getDb();
  const crop = String(formData.get("crop") ?? "corn");
  const year = Number(formData.get("year") ?? new Date().getFullYear());

  if (!VALID_CROPS.has(crop)) throw new Error("Unknown crop");
  if (!Number.isInteger(year) || year < 2020 || year > 2035) throw new Error("Year out of range");

  const values = {
    operationId: op.id,
    crop,
    year,
    acres: numBounded(formData, "acres", 0, 200_000),
    expectedYieldBuPerAcre: numBounded(formData, "expectedYield", 0, 400),
    producedBu: numBounded(formData, "producedBu", 0, 50_000_000),
    storedBu: numBounded(formData, "storedBu", 0, 50_000_000),
    soldBu: numBounded(formData, "soldBu", 0, 50_000_000),
    avgSoldPrice: numBounded(formData, "avgSoldPrice", 0, 50),
    contractedBu: numBounded(formData, "contractedBu", 0, 50_000_000),
    costOfProductionPerAcre: numBounded(formData, "costPerAcre", 0, 10_000),
    insuranceFloorPerBu: numBounded(formData, "insuranceFloor", 0, 50),
    currentCashPrice: numBounded(formData, "cashPrice", 0, 50),
    currentFuturesPrice: numBounded(formData, "futuresPrice", 0, 50),
    typicalBasisLo: numBounded(formData, "basisLo", -10, 10),
    typicalBasisHi: numBounded(formData, "basisHi", -10, 10),
    storageCapacityBu: numBounded(formData, "storageCapacity", 0, 50_000_000),
    storageCostPerBuMonth: numBounded(formData, "storageCost", 0, 5),
    cashNeedUsd: numBounded(formData, "cashNeed", 0, 100_000_000),
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
  const { op } = await requireWrite();
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
  const { op } = await requireWrite();
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

// ————— Hard cores: satellite analysis, boundaries, labels, triggers —————

/** Set a field boundary: paste a GeoJSON Polygon, or approximate from center + acres. */
export async function setFieldBoundary(fieldId: string, formData: FormData) {
  const { op } = await requireWrite();
  const db = await getDb();
  const field = (
    await db.select().from(t.fields).where(and(eq(t.fields.id, fieldId), eq(t.fields.operationId, op.id)))
  )[0];
  if (!field) throw new Error("Unknown field");

  let boundary: GeoJSONPolygon | null = null;
  let approximate = false;
  const geojsonRaw = String(formData.get("geojson") ?? "").trim();
  if (geojsonRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(geojsonRaw);
    } catch {
      throw new Error("Boundary is not valid JSON");
    }
    // accept Polygon, Feature<Polygon>, or FeatureCollection with one polygon
    const g = parsed as { type?: string; geometry?: unknown; features?: Array<{ geometry?: unknown }> };
    const geom = (g.type === "Polygon" ? g : g.type === "Feature" ? g.geometry : g.features?.[0]?.geometry) as
      | GeoJSONPolygon
      | undefined;
    if (!geom || geom.type !== "Polygon" || !Array.isArray(geom.coordinates?.[0]) || geom.coordinates[0].length < 4)
      throw new Error("Provide a GeoJSON Polygon (or a Feature containing one)");
    const ring = geom.coordinates[0];
    for (const pt of ring) {
      if (!Array.isArray(pt) || Math.abs(pt[0]) > 180 || Math.abs(pt[1]) > 90)
        throw new Error("Boundary coordinates must be [longitude, latitude]");
    }
    boundary = { type: "Polygon", coordinates: [ring] };
  } else {
    const lat = Number(formData.get("lat"));
    const lng = Number(formData.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      throw new Error("Enter the field's center latitude and longitude");
    boundary = approxRectBoundary(lng, lat, field.acres);
    approximate = true;
  }

  const c0 = boundary.coordinates[0][0];
  const utm = ringToUtm(boundary, epsgForLngLat(c0[0], c0[1]));
  const acres = Math.round(ringAcres(utm.ring) * 10) / 10;
  if (acres < 0.5 || acres > 100_000) throw new Error(`Boundary computes to ${acres} acres — check the coordinates`);

  await db.update(t.fields).set({ boundary, acres: approximate ? field.acres : acres }).where(eq(t.fields.id, fieldId));
  await audit(op.id, "boundary_set", "field", fieldId, { acres, approximate });
  revalidatePath(`/fields/${fieldId}`);
  revalidatePath("/fields");
}

/**
 * Scan a batch of Sentinel-2 scenes for a field — as a background job so
 * the farmer's click returns immediately. Bounded per run (~20 scenes) to
 * fit the serverless time budget; the button continues where it left off.
 * Scans the current season first, then walks back a year at a time so
 * baselines accumulate. UI polls /api/jobs/[id].
 */
export async function scanFieldAction(fieldId: string): Promise<{ jobId: string }> {
  const { op } = await requireWrite();
  const db = await getDb();
  const field = (
    await db.select().from(t.fields).where(and(eq(t.fields.id, fieldId), eq(t.fields.operationId, op.id)))
  )[0];
  if (!field) throw new Error("Unknown field");
  if (!field.boundary) throw new Error("Add a boundary first");

  const job = await createJob(op.id, "satellite_scan", fieldId);
  after(async () => {
    await runJob(job.id, async (setProgress) => {
      const thisYear = new Date().getFullYear();
      let budget = 20; // scenes per run
      const results: Array<{ year: number; observed: number; searched: number }> = [];
      for (let y = thisYear; y >= thisYear - 3 && budget > 0; y--) {
        await setProgress(`Scanning ${y} season (${20 - budget}/20 scenes so far)`);
        const r = await scanField(
          db,
          field,
          `${y}-04-01`,
          y === thisYear ? new Date().toISOString().slice(0, 10) : `${y}-10-31`,
          { maxScenes: budget }
        );
        results.push({ year: y, observed: r.observed, searched: r.searched });
        budget -= r.observed;
        if (r.failed.length > 0 && r.observed === 0) break; // network trouble — stop burning the budget
      }
      await audit(op.id, "satellite_scan", "field", fieldId, { results });
      revalidatePath(`/fields/${fieldId}`);
      revalidatePath("/marketing");
      const observed = results.reduce((s, r) => s + r.observed, 0);
      return { results, observed };
    });
  });
  return { jobId: job.id };
}

/**
 * Satellite damage analysis for a claim — THE primary evidence path for
 * real operations (the demo stub is registry-barred from them). Emits a
 * Field Condition Record with the full detection trace, reference captures
 * for the exact scenes used, and provenance-chain entries for all of it.
 */
export async function analyzeClaimSatellite(claimId: string) {
  const { op } = await requireWrite();
  const db = await getDb();
  const claim = (
    await db.select().from(t.claims).where(and(eq(t.claims.id, claimId), eq(t.claims.operationId, op.id)))
  )[0];
  if (!claim) throw new Error("Unknown claim");
  const field = (await db.select().from(t.fields).where(eq(t.fields.id, claim.fieldId)))[0];
  if (!field) throw new Error("Unknown field");

  const model = primaryModelFor(op.isDemo);
  const assessment = await model.assess(db, field, claim.eventDate);

  // USDA CDL crop verification — additive evidence ("the USDA's own layer
  // says this boundary was X% corn that season"). CDL for a year publishes
  // the following winter, so a current-season event falls back to last year.
  const eventYear = Number(claim.eventDate.slice(0, 4));
  let cdl = field.boundary ? await cdlComposition(field.boundary, eventYear) : null;
  let cdlNote = "";
  if (!cdl && field.boundary) {
    cdl = await cdlComposition(field.boundary, eventYear - 1);
    cdlNote = ` (CDL ${eventYear} not yet published — showing ${eventYear - 1})`;
  }

  if (!assessment.ok) {
    // no fabricated record on failure — the reason is surfaced in the UI via audit trail
    await audit(op.id, "satellite_analysis_unavailable", "claim", claimId, {
      reason: assessment.reason,
    });
    revalidatePath(`/claims/${claimId}`);
    return;
  }

  // reference captures for the exact scenes the assessment used
  const captureIds: string[] = [];
  const sceneHashes: string[] = [];
  for (const scene of [assessment.trace.preScene, assessment.trace.postScene]) {
    if (!scene) continue;
    const capId = id("cap");
    captureIds.push(capId);
    sceneHashes.push(scene.refHash);
    await db
      .insert(t.imageryCaptures)
      .values({
        id: capId,
        fieldId: field.id,
        source: "satellite",
        capturedAt: scene.datetime,
        lat: null,
        lng: null,
        fileName: scene.id,
        sha256: scene.refHash, // deterministic reference hash (public immutable archive)
        bytes: 0,
        storageUrl: null,
        storageBackend: "reference",
        uploadedBy: "pipeline",
        uploadedAt: now(),
        metadata: {
          kind: "sentinel-2-scene-reference",
          note: "Scene referenced from the public Sentinel-2 archive; refHash identifies the exact assets analyzed.",
        },
      })
      .onConflictDoNothing();
    await appendProvenance(db, "imagery_capture", capId, "scene_referenced", scene);
  }

  const season = claim.cropSeasonId
    ? (await db.select().from(t.cropSeasons).where(eq(t.cropSeasons.id, claim.cropSeasonId)))[0]
    : undefined;
  const fcrId = id("fcr");
  await db.insert(t.fieldConditionRecords).values({
    id: fcrId,
    fieldId: field.id,
    cropSeasonId: claim.cropSeasonId,
    observedAt: assessment.trace.postScene?.datetime ?? now(),
    crop: season?.crop ?? "unknown",
    growthStage: null, // satellite change detection doesn't stage the crop — stated, not guessed
    conditionClass: assessment.conditionClass,
    damageType: claim.damageType,
    severityPct: assessment.significant ? assessment.severityPct : 0,
    affectedAcres: assessment.significant ? assessment.affectedAcres : 0,
    affectedArea: (assessment.affectedArea as never) ?? null,
    metrics: {
      ...assessment.metrics,
      significant: assessment.significant ? 1 : 0,
      extent_localized: assessment.extent === "localized" ? 1 : 0,
      persistence_persistent: assessment.persistence === "persistent" ? 1 : 0,
      ...(cdl ? { cdl_dominant_fraction: cdl.dominantFraction, cdl_year: cdl.year } : {}),
    },
    narrative:
      assessment.narrative +
      (cdl
        ? ` USDA Cropland Data Layer (${cdl.year}) classifies ${Math.round(cdl.dominantFraction * 100)}% of this boundary as ${cdl.dominant}${cdlNote}.`
        : ""),
    confidence: assessment.confidence,
    captureIds,
    imagerySha256: sceneHashes,
    modelName: model.name,
    modelVersion: model.version,
    pipelineRunId: id("run"),
    analyzedAt: now(),
    reviewedBy: null,
    supersedes: claim.fcrIds.at(-1) ?? null,
  });
  await audit(op.id, "fcr_emitted", "field_condition_record", fcrId, {
    claimId,
    model: `${model.name}@${model.version}`,
    significant: assessment.significant,
  });
  await appendProvenance(db, "field_condition_record", fcrId, "emitted", {
    claimId,
    model: `${model.name}@${model.version}`,
    assessment: {
      significant: assessment.significant,
      extent: assessment.extent,
      persistence: assessment.persistence,
      severityPct: assessment.severityPct,
      affectedAcres: assessment.affectedAcres,
      confidence: assessment.confidence,
      metrics: assessment.metrics,
      trace: assessment.trace,
    },
    cdl,
  });

  await db
    .update(t.claims)
    .set({ status: "evidence", fcrIds: [...claim.fcrIds, fcrId] })
    .where(eq(t.claims.id, claimId));
  revalidatePath(`/claims/${claimId}`);
  revalidatePath("/claims");
  revalidatePath("/");
}

/** Record a confirmed real-world outcome — the ground-truth label flywheel.
 * Advisors (agronomist/agent) may record outcomes too — it's the one write
 * their read-mostly role includes, because they're often the source. */
export async function recordOutcome(claimId: string, formData: FormData) {
  const access = await requireAccess();
  if (!canRecordOutcome(access))
    throw new Error("The demo is read-only sample data. Set up your own farm at /setup.");
  const op = access.op;
  const db = await getDb();
  const claim = (
    await db.select().from(t.claims).where(and(eq(t.claims.id, claimId), eq(t.claims.operationId, op.id)))
  )[0];
  if (!claim) throw new Error("Unknown claim");
  const labelType = String(formData.get("labelType"));
  const value = Number(formData.get("value"));
  const unitByType: Record<string, string> = {
    farmer_damage_pct: "pct",
    adjuster_settlement_pct: "pct",
    harvested_yield_bu_ac: "bu_per_acre",
  };
  if (!(labelType in unitByType) || !Number.isFinite(value) || value < 0) return;

  const labelId = id("lbl");
  await db.insert(t.groundTruthLabels).values({
    id: labelId,
    operationId: op.id,
    fieldId: claim.fieldId,
    claimId,
    fcrId: claim.fcrIds.at(-1) ?? null,
    labelType,
    value,
    unit: unitByType[labelType],
    source: String(formData.get("source") ?? "farmer"),
    notes: String(formData.get("notes") ?? "").slice(0, 500) || null,
    recordedBy: op.id,
    recordedAt: now(),
  });
  await audit(op.id, "ground_truth_recorded", "ground_truth_label", labelId, { claimId, labelType, value });
  await appendProvenance(db, "ground_truth_label", labelId, "recorded", {
    claimId,
    fieldId: claim.fieldId,
    fcrId: claim.fcrIds.at(-1) ?? null,
    labelType,
    value,
  });
  revalidatePath(`/claims/${claimId}`);
}

/**
 * Evaluate a sample parametric trigger over the field's stored observations
 * for a window, alongside the weather-index counterpart (the basis-risk
 * comparison). Creates an inactive demo definition on first use — real
 * definitions require a carrier partner (docs/DEPENDENCIES.md §5/§6).
 */
export async function evaluateTriggerAction(fieldId: string, formData: FormData) {
  const { op } = await requireWrite();
  const db = await getDb();
  const field = (
    await db.select().from(t.fields).where(and(eq(t.fields.id, fieldId), eq(t.fields.operationId, op.id)))
  )[0];
  if (!field) throw new Error("Unknown field");

  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  const threshold = Number(formData.get("threshold") ?? 0.35);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from >= to)
    throw new Error("Enter a valid from/to window");
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) throw new Error("Threshold must be in (0,1)");

  const m = defaultDroughtStressMethodology(threshold);
  const mHash = methodologyHash(m);

  // one demo definition per field+methodology, always inactive (no carrier)
  const defId = `tdef_${fieldId}_${mHash.slice(0, 8)}`;
  await db
    .insert(t.triggerDefinitions)
    .values({
      id: defId,
      fieldId,
      version: 1,
      metric: m.metric,
      comparator: m.comparator,
      threshold: m.threshold,
      consecutiveObservations: m.consecutiveObservations,
      imagerySourceClass: m.imagerySourceClass,
      carrierContractRef: null, // ← the hard gate: no carrier, no active trigger
      methodologyParams: m as unknown as Record<string, unknown>,
      methodologyHash: mHash,
      active: false,
    })
    .onConflictDoNothing();

  const evaluation = await evaluateTrigger(db, field, defId, m, from, to);

  // weather-index counterpart + gap, attached to the stored evaluation
  const weather = await evaluateWeatherCounterpart(field, from, to);
  const gap = basisRiskGap(evaluation.fired, weather.weatherFired);
  const row = (
    await db.select().from(t.triggerEvaluations).where(eq(t.triggerEvaluations.id, evaluation.evaluationId))
  )[0];
  await db
    .update(t.triggerEvaluations)
    .set({
      calculationTrace: {
        ...row.calculationTrace,
        weatherCounterpart: weather as unknown as Record<string, unknown>,
        basisRiskGap: gap,
      },
    })
    .where(eq(t.triggerEvaluations.id, evaluation.evaluationId));
  await appendProvenance(db, "trigger_evaluation", evaluation.evaluationId, "weather_counterpart_attached", {
    weather,
    gap,
  });
  await audit(op.id, "trigger_evaluated", "trigger_evaluation", evaluation.evaluationId, {
    fieldId,
    fired: evaluation.fired,
    weatherFired: weather.weatherFired,
    gap: gap.gap,
  });
  revalidatePath(`/fields/${fieldId}`);
}
