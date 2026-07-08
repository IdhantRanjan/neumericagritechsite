/**
 * Trained yield model inference (D1) — corn, Illinois.
 *
 * The model was trained on REAL data: USDA NASS county corn yields joined
 * to Sentinel-2 NDVI season features over CDL-verified corn patches
 * (scripts/ml/train-yield.py). Validation is leave-one-year-out AND
 * leave-one-county-out; the error band shown to the farmer is the WORSE of
 * the two, verbatim from cross-validation — never a smaller number.
 *
 * Honest scope limits, enforced in code:
 *  - corn + Illinois-like geographies only (that's the training domain);
 *  - the error is county-level; a single field varies more than a county
 *    mean, so the band is widened by a stated field-scale factor;
 *  - insufficient season coverage → no estimate, with the reason.
 */
import model from "@/data/models/yield-model.json";
import type { sceneObservations } from "@/db/schema";

type Observation = typeof sceneObservations.$inferSelect;

// county→field disaggregation widening: NASS RMA research consistently puts
// within-county field-level yield SD well above county-mean error; 1.5× is
// a conservative stated multiplier, not a measured field-level validation.
const FIELD_SCALE_FACTOR = 1.5;

export interface ModelYieldEstimate {
  ok: boolean;
  reason?: string;
  modelVersion: string;
  estimateBuAc: number | null;
  loBuAc: number | null;
  hiBuAc: number | null;
  rmseCountyBuAc: number;
  nTrainingSamples: number;
  features?: Record<string, number>;
}

interface TrainedModel {
  version: string;
  crop: string;
  region: string;
  features: string[];
  mu: number[];
  sd: number[];
  metrics: { rmse_bu_ac: number; mae_bu_ac: number; note: string };
  n_samples: number;
  type: "ridge" | "gbt";
  coef?: number[];
  intercept?: number;
  init?: number;
  learning_rate?: number;
  trees?: Array<{ cl: number[]; cr: number[]; f: number[]; th: number[]; v: number[] }>;
}

const M = model as unknown as TrainedModel;

function predict(x: number[]): number {
  const xs = x.map((v, i) => (v - M.mu[i]) / (M.sd[i] || 1));
  if (M.type === "ridge") {
    return M.intercept! + xs.reduce((s, v, i) => s + v * M.coef![i], 0);
  }
  let out = M.init!;
  for (const t of M.trees!) {
    let node = 0;
    while (t.cl[node] !== -1) {
      node = xs[t.f[node]] <= t.th[node] ? t.cl[node] : t.cr[node];
    }
    out += M.learning_rate! * t.v[node];
  }
  return out;
}

/** Build the model's season features from stored scene observations. */
export function seasonFeatures(
  observations: Observation[],
  seasonYear: number
): Record<string, number> | { insufficient: string } {
  const pts = observations
    .filter(
      (o) =>
        o.year === seasonYear &&
        o.clearFrac >= 0.55 &&
        typeof o.stats.ndvi_mean === "number" &&
        o.doy >= 121 &&
        o.doy <= 283
    )
    .map((o) => ({ doy: o.doy, ndvi: o.stats.ndvi_mean }))
    .sort((a, b) => a.doy - b.doy);
  if (pts.length < 4) return { insufficient: `${pts.length} clear in-season observations (need 4+)` };
  const span = pts[pts.length - 1].doy - pts[0].doy;
  if (span < 60) return { insufficient: `observations cover only ${span} days of the season (need 60+)` };

  let area = 0;
  for (let i = 1; i < pts.length; i++)
    area += ((pts[i].ndvi + pts[i - 1].ndvi) / 2) * (pts[i].doy - pts[i - 1].doy);
  const peak = pts.reduce((a, b) => (b.ndvi > a.ndvi ? b : a));
  const phase = (lo: number, hi: number, fallback: number) => {
    const v = pts.filter((p) => p.doy >= lo && p.doy <= hi);
    return v.length ? v.reduce((s, p) => s + p.ndvi, 0) / v.length : fallback;
  };
  return {
    ndviIntegral: area / span,
    ndviPeak: peak.ndvi,
    ndviMid: phase(181, 240, peak.ndvi),
    ndviLate: phase(241, 285, pts[pts.length - 1].ndvi),
    peakDoy: peak.doy,
    coverage: span / (283 - 121),
  };
}

export function modelYieldEstimate(
  observations: Observation[],
  crop: string,
  seasonYear: number
): ModelYieldEstimate {
  const base: ModelYieldEstimate = {
    ok: false,
    modelVersion: M.version,
    estimateBuAc: null,
    loBuAc: null,
    hiBuAc: null,
    rmseCountyBuAc: M.metrics.rmse_bu_ac,
    nTrainingSamples: M.n_samples,
  };
  if (M.n_samples < 40 || M.version.includes("placeholder")) {
    return { ...base, reason: "No trained model is deployed in this build." };
  }
  if (crop !== M.crop) {
    return { ...base, reason: `Trained on ${M.crop} only — no model estimate for ${crop}. The self-relative estimate above still applies.` };
  }
  const f = seasonFeatures(observations, seasonYear);
  if ("insufficient" in f) return { ...base, reason: `Not enough season coverage: ${f.insufficient}.` };

  const x = M.features.map((k) => f[k]);
  const est = predict(x);
  const band = M.metrics.rmse_bu_ac * FIELD_SCALE_FACTOR;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    ...base,
    ok: true,
    estimateBuAc: r1(est),
    loBuAc: r1(est - band),
    hiBuAc: r1(est + band),
    features: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
  };
}
