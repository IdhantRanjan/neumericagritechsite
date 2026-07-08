/**
 * Training-data export (Hard Core 2) — the feature store's read side.
 *
 * For every ground-truth label, materialize a training-ready row joining:
 *   label (the y) ← FCR metrics at assessment time (the x, already
 *   deterministic + versioned) ← season time-series features from stored
 *   scene observations.
 *
 * Rows are keyed by methodology version so a future model trains only on
 * features produced by a consistent pipeline. When ~150+ labeled events per
 * damage type exist (docs/ENGINES.md §2), this export IS the training set —
 * nothing else needs building.
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
  features: Record<string, number>;
  featureCompleteness: number; // fraction of expected feature slots populated
}

const SEASON_FEATURES = ["ndvi_season_mean", "ndvi_season_min", "ndvi_season_obs_n"];

export async function exportTrainingRows(db: DB): Promise<TrainingRow[]> {
  const labels = await db.select().from(t.groundTruthLabels);
  const rows: TrainingRow[] = [];

  for (const label of labels) {
    const fcr = label.fcrId
      ? (await db.select().from(t.fieldConditionRecords).where(eq(t.fieldConditionRecords.id, label.fcrId)))[0]
      : undefined;
    const claim = label.claimId
      ? (await db.select().from(t.claims).where(eq(t.claims.id, label.claimId)))[0]
      : undefined;

    const features: Record<string, number> = {};
    if (fcr) {
      for (const [k, v] of Object.entries(fcr.metrics)) {
        if (typeof v === "number" && Number.isFinite(v)) features[`fcr_${k}`] = v;
      }
      if (fcr.severityPct != null) features.fcr_severity_pct = fcr.severityPct;
      if (fcr.affectedAcres != null) features.fcr_affected_acres = fcr.affectedAcres;
      features.fcr_confidence = fcr.confidence;
    }

    // season-level time-series features for the label's year
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

    const expected = (fcr ? Object.keys(fcr.metrics).length + 3 : 0) + SEASON_FEATURES.length;
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
      crop: fcr?.crop ?? null,
      methodologyVersion: fcr?.modelVersion ?? null,
      features,
      featureCompleteness: expected > 0 ? Math.round((Object.keys(features).length / expected) * 100) / 100 : 0,
    });
  }
  return rows;
}
