/**
 * Training-data export (Hard Core 2) — the feature store's read side.
 *
 * For every ground-truth label, materialize a training-ready row joining:
 *   label (the y) ← FCR metrics at assessment time (the x, already
 *   deterministic + versioned) ← season time-series features from stored
 *   scene observations.
 *
 * Rows are keyed by methodology version so a future model trains only on
 * features produced by a consistent pipeline. Features are TIER-AWARE: a
 * claim can carry both a satellite FCR and a drone FCR, and both sets of
 * features are emitted (prefixed `sat_` / `drone_`) so a supervised model
 * can learn from either or fuse them. When ~150+ labeled field-events per
 * damage type exist (docs/ENGINES.md §2b), this export IS the training set.
 */
import { eq } from "drizzle-orm";
import { tables as t, type DB } from "@/db";
import { getObservations } from "@/lib/satellite/scan";

export interface TrainingRow {
  labelId: string;
  labelType: string;
  y: number;
  yUnit: string;
  labelSource: string;
  recordedAt: string;
  fieldId: string;
  claimId: string | null;
  fcrId: string | null;
  eventDate: string | null;
  damageType: string | null;
  crop: string | null;
  methodologyVersion: string | null;
  sensorTiers: string[]; // which sensor tiers contributed features to this row
  features: Record<string, number>;
  featureCompleteness: number; // fraction of expected feature slots populated
  // B1 capture-session provenance: is this a calibration-grade example
  // (objective outcome attached) or a lower-weight human-estimate example?
  captureGrade: "calibration_grade" | "human_estimate" | "none";
  zoneEstimates: Array<{ zone: string; lossPct: number; acres: number }> | null;
  flight: { gsdCm: number | null; bands: string | null; groundControl: string | null } | null;
}

/** Model name → tier prefix for feature namespacing. */
function tierPrefix(modelName: string): string {
  if (modelName.startsWith("drone")) return "drone";
  if (modelName === "demo-analyzer") return "demo";
  return "sat";
}

export async function exportTrainingRows(db: DB): Promise<TrainingRow[]> {
  const labels = await db.select().from(t.groundTruthLabels);
  const rows: TrainingRow[] = [];

  for (const label of labels) {
    const claim = label.claimId
      ? (await db.select().from(t.claims).where(eq(t.claims.id, label.claimId)))[0]
      : undefined;

    // All FCRs on the claim, not just the one the label points at — a claim
    // may carry both satellite and drone evidence, and both are real features.
    const fcrIds = claim ? claim.fcrIds : label.fcrId ? [label.fcrId] : [];
    const fcrs = (
      await Promise.all(
        fcrIds.map((fid) =>
          db.select().from(t.fieldConditionRecords).where(eq(t.fieldConditionRecords.id, fid))
        )
      )
    )
      .map((r) => r[0])
      .filter(Boolean);

    const features: Record<string, number> = {};
    const tiers = new Set<string>();
    let primaryFcr: (typeof fcrs)[number] | undefined;
    for (const fcr of fcrs) {
      const pfx = tierPrefix(fcr.modelName);
      if (pfx === "demo") continue; // demo output is never training fuel
      tiers.add(pfx);
      if (!primaryFcr || pfx === "sat") primaryFcr = fcr;
      for (const [k, v] of Object.entries(fcr.metrics)) {
        if (typeof v === "number" && Number.isFinite(v)) features[`${pfx}_${k}`] = v;
      }
      if (fcr.severityPct != null) features[`${pfx}_severity_pct`] = fcr.severityPct;
      if (fcr.affectedAcres != null) features[`${pfx}_affected_acres`] = fcr.affectedAcres;
      features[`${pfx}_confidence`] = fcr.confidence;
    }

    // season-level satellite time-series features for the label's year
    const year = Number((claim?.eventDate ?? label.recordedAt).slice(0, 4));
    const obs = (await getObservations(db, label.fieldId)).filter(
      (o) => o.year === year && o.clearFrac >= 0.6 && typeof o.stats.ndvi_mean === "number"
    );
    if (obs.length > 0) {
      const vals = obs.map((o) => o.stats.ndvi_mean);
      features.ndvi_season_mean = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1e4) / 1e4;
      features.ndvi_season_min = Math.round(Math.min(...vals) * 1e4) / 1e4;
      features.ndvi_season_obs_n = vals.length;
    }

    // B1 capture session for this claim (flight metadata + frozen zone estimates)
    const session = label.claimId
      ? (await db.select().from(t.captureSessions).where(eq(t.captureSessions.claimId, label.claimId)))[0]
      : undefined;
    const isObjective =
      label.labelType === "adjuster_settlement_pct" || label.labelType === "harvested_yield_bu_ac";

    rows.push({
      labelId: label.id,
      labelType: label.labelType,
      y: label.value,
      yUnit: label.unit,
      labelSource: label.source,
      recordedAt: label.recordedAt,
      fieldId: label.fieldId,
      claimId: label.claimId,
      fcrId: label.fcrId,
      eventDate: claim?.eventDate ?? null,
      damageType: claim?.damageType ?? null,
      crop: primaryFcr?.crop ?? null,
      methodologyVersion: primaryFcr?.modelVersion ?? null,
      sensorTiers: [...tiers],
      features,
      // completeness relative to a satellite+season baseline of ~12 slots
      featureCompleteness: Math.min(1, Math.round((Object.keys(features).length / 12) * 100) / 100),
      captureGrade: isObjective ? "calibration_grade" : session ? "human_estimate" : "none",
      zoneEstimates: session?.zoneEstimates?.map((z) => ({ zone: z.zone, lossPct: z.lossPct, acres: z.acres })) ?? null,
      flight: session
        ? { gsdCm: session.gsdCm ?? null, bands: session.bands ?? null, groundControl: session.groundControl ?? null }
        : null,
    });
  }
  return rows;
}
