/**
 * Demo seed — a single sample operation so every screen demos end to end.
 * ALL of this is fictional and badged as demo data in the UI (isDemo flag,
 * "(Sample)" names, demo-analyzer provenance). Never mix with real records.
 */
import { createHash } from "node:crypto";
import * as t from "./schema";
import { applicableRules } from "@/lib/rules/deadlines";
import { matchPrograms } from "@/lib/rules/programs";

import type { DB } from "./index";

const now = () => new Date().toISOString();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Rectangular boundary around a centroid sized to the stated acreage (demo only). */
function demoBoundary(lng: number, lat: number, acres: number): t.GeoJSONPolygon {
  const m2 = acres * 4046.8564224;
  const widthM = Math.sqrt(m2 * 1.5); // 1.5:1 aspect, like a typical quarter-section split
  const heightM = m2 / widthM;
  const dLng = widthM / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
  const dLat = heightM / 2 / 110574;
  return {
    type: "Polygon",
    coordinates: [[
      [lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng + dLng, lat + dLat],
      [lng - dLng, lat + dLat], [lng - dLng, lat - dLat],
    ]],
  };
}

export async function seedIfEmpty(db: DB) {
  const existing = await db.select().from(t.operations).limit(1);
  if (existing.length > 0) return;

  const OP = "op_demo";
  await db.insert(t.operations).values({
    id: OP,
    name: "Prairie Creek Farms (Sample)",
    state: "IL",
    counties: ["DeKalb", "Kane"],
    entityType: "family_llc",
    isDemo: true,
    accessToken: "demo",
    hasBaseAcres: true,
    storesGrainOnFarm: true,
    usesCoverCrops: false,
    usesNoTill: true,
    createdAt: now(),
  });

  const fieldRows = [
    { id: "fld_home", name: "Home 80", county: "DeKalb", acres: 78.4, lng: -88.742, lat: 41.912, farm: "2841", tract: "1107", fld: "3" },
    { id: "fld_creek", name: "Creek Bottom", county: "DeKalb", acres: 112.6, lng: -88.701, lat: 41.887, farm: "2841", tract: "1107", fld: "5" },
    { id: "fld_north", name: "North Quarter", county: "Kane", acres: 154.2, lng: -88.512, lat: 41.958, farm: "3302", tract: "884", fld: "1" },
  ];
  for (const f of fieldRows) {
    await db.insert(t.fields).values({
      id: f.id, operationId: OP, name: f.name, county: f.county, acres: f.acres,
      boundary: demoBoundary(f.lng, f.lat, f.acres),
      fsaFarmNumber: f.farm, fsaTractNumber: f.tract, fsaFieldNumber: f.fld,
    });
  }

  const seasons = [
    { id: "cs_home_corn", fieldId: "fld_home", crop: "corn", plantingDate: "2026-04-28", intended: 78.4, reported: 78.4 },
    { id: "cs_creek_soy", fieldId: "fld_creek", crop: "soybeans", plantingDate: "2026-05-14", intended: 112.6, reported: null },
    { id: "cs_north_corn", fieldId: "fld_north", crop: "corn", plantingDate: "2026-05-02", intended: 154.2, reported: null },
  ];
  for (const s of seasons) {
    await db.insert(t.cropSeasons).values({
      id: s.id, fieldId: s.fieldId, crop: s.crop, year: 2026, practice: "non_irrigated",
      plantingDate: s.plantingDate, intendedAcres: s.intended, reportedAcres: s.reported,
    });
  }

  await db.insert(t.policyRefs).values({
    id: "pol_corn26", operationId: OP, crop: "corn", year: 2026, planType: "RP",
    coverageLevelPct: 80, aipName: "Sample Mutual Insurance (fictional)",
    agentName: "Sample Agent", agentPhone: "(555) 015-0100", policyNumber: "SAMPLE-0042",
  });

  // Materialize deadline instances from the rules layer
  const crops = ["corn", "soybeans"];
  for (const rule of applicableRules("IL", 2026, crops)) {
    await db.insert(t.deadlineInstances).values({
      id: `dl_${rule.id}`, operationId: OP, ruleId: rule.id,
      crop: rule.crops.join(" + "), dueDate: rule.date!,
      status: new Date(rule.date! + "T23:59:59") < new Date() ? "done" : "upcoming",
      completedAt: null,
    });
  }

  // Program matches from the eligibility engine
  for (const m of matchPrograms({
    state: "IL", crops, hasBaseAcres: true, storesGrainOnFarm: true,
    usesCoverCrops: false, usesNoTill: true, hasDocumentedLoss: true,
    filedAcreageReport: false,
  })) {
    await db.insert(t.programMatches).values({
      id: `pm_${m.program.id}`, operationId: OP, programId: m.program.id,
      matchedCriteria: m.matched, missingCriteria: m.missing,
      strength: m.strength, status: "new", evaluatedAt: now(),
    });
  }

  // One worked example claim: hail on Home 80, June 28 2026
  const captures = [
    { id: "cap_1", name: "IMG_2841_northwest-corner.jpg", at: "2026-06-29T09:12:00Z", lat: 41.9145, lng: -88.7472 },
    { id: "cap_2", name: "IMG_2842_center-strip.jpg", at: "2026-06-29T09:18:00Z", lat: 41.9121, lng: -88.7419 },
    { id: "cap_3", name: "ortho_home80_2026-06-29.tif", at: "2026-06-29T10:40:00Z", lat: 41.912, lng: -88.742 },
  ];
  for (const c of captures) {
    await db.insert(t.imageryCaptures).values({
      id: c.id, fieldId: "fld_home", source: c.id === "cap_3" ? "drone" : "phone",
      capturedAt: c.at, lat: c.lat, lng: c.lng, fileName: c.name,
      sha256: sha("demo:" + c.name), bytes: 4_200_000 + c.name.length * 1000,
      uploadedBy: "demo-farmer", uploadedAt: "2026-06-29T11:02:00Z",
      metadata: { note: "sample capture — no real imagery behind this record" },
    });
  }

  await db.insert(t.fieldConditionRecords).values({
    id: "fcr_demo_hail", fieldId: "fld_home", cropSeasonId: "cs_home_corn",
    observedAt: "2026-06-29T09:12:00Z", crop: "corn", growthStage: "V10–V12",
    conditionClass: "damaged", damageType: "hail", severityPct: 54, affectedAcres: 46.2,
    affectedArea: null,
    metrics: { ndvi_mean: 0.41, ndvi_baseline: 0.78, canopy_cover_pct: 62, affected_area_frac: 0.59 },
    confidence: 0.82,
    captureIds: captures.map((c) => c.id),
    imagerySha256: captures.map((c) => sha("demo:" + c.name)),
    modelName: "demo-analyzer", modelVersion: "0.1.0",
    pipelineRunId: "run_demo_0001", analyzedAt: "2026-06-29T11:05:00Z",
    reviewedBy: null, supersedes: null,
  });

  await db.insert(t.claims).values({
    id: "clm_demo_hail", operationId: OP, fieldId: "fld_home", cropSeasonId: "cs_home_corn",
    policyRefId: "pol_corn26", damageType: "hail", eventDate: "2026-06-28",
    discoveredDate: "2026-06-29",
    narrative: "Hail moved through the evening of June 28. Worst damage in the northwest half of Home 80 — shredded leaves, broken stalks in strips.",
    status: "evidence", fcrIds: ["fcr_demo_hail"], createdAt: "2026-06-29T11:10:00Z",
  });

  // Marketing position — 2026 corn, mid-season numbers (fictional)
  await db.insert(t.marketingPositions).values({
    id: "mkt_demo_corn26", operationId: OP, crop: "corn", year: 2026,
    acres: 232.6, expectedYieldBuPerAcre: 205,
    producedBu: null, storedBu: 9500, soldBu: 12000, avgSoldPrice: 4.62,
    contractedBu: 8000, costOfProductionPerAcre: 812, insuranceFloorPerBu: 3.94,
    currentCashPrice: 4.18, currentFuturesPrice: 4.43,
    typicalBasisLo: -0.35, typicalBasisHi: -0.15,
    storageCapacityBu: 20000, storageCostPerBuMonth: 0.045,
    cashNeedUsd: 60000, cashNeedByDate: "2026-11-01",
    updatedAt: now(),
  });
  await db.insert(t.marketingPlanTargets).values([
    {
      id: "tgt_demo_1", positionId: "mkt_demo_corn26", kind: "cash_price",
      targetValue: 4.55, amountBu: 5000,
      note: "Second tranche if cash gets back above breakeven + 25¢",
      status: "waiting", createdAt: now(),
    },
    {
      id: "tgt_demo_2", positionId: "mkt_demo_corn26", kind: "basis",
      targetValue: -0.18, amountBu: 4500,
      note: "Move stored bushels when basis tightens to the strong end of normal",
      status: "waiting", createdAt: now(),
    },
  ]);

  await db.insert(t.auditEvents).values({
    id: "aud_seed", actor: "system", action: "seed_demo_data",
    entityType: "operation", entityId: OP,
    detail: { note: "fictional sample data for product demo" }, at: now(),
  });
}
