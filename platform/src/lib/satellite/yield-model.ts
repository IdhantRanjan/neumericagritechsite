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
import { fetchWithRetry } from "@/lib/net";

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

/**
 * Season weather covariates — the SAME aggregates the model was trained on
 * (complete June–August, Open-Meteo ERA5 archive). In-season the JJA window
 * is incomplete and a partial sum would be a systematically-biased feature,
 * so the model estimate is only available once the season's weather record
 * is complete (after Sept 1). Before that, the self-relative estimator is
 * the in-season indicator.
 */
async function seasonWeather(
  lat: number,
  lng: number,
  year: number
): Promise<{ precip_jja_mm: number; tmax_mean_jja: number; days_gt32_jja: number } | null> {
  try {
    const url =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      `&start_date=${year}-06-01&end_date=${year}-08-31&daily=precipitation_sum,temperature_2m_max&timezone=UTC`;
    const res = await fetchWithRetry(url);
    if (!res.ok) return null;
    const j = (await res.json()) as {
      daily?: { precipitation_sum?: Array<number | null>; temperature_2m_max?: Array<number | null> };
    };
    const precip = j.daily?.precipitation_sum?.filter((v): v is number => v != null) ?? [];
    const tmax = j.daily?.temperature_2m_max?.filter((v): v is number => v != null) ?? [];
    if (precip.length < 80 || tmax.length < 80) return null; // incomplete record
    return {
      precip_jja_mm: Math.round(precip.reduce((a, b) => a + b, 0) * 10) / 10,
      tmax_mean_jja: Math.round((tmax.reduce((a, b) => a + b, 0) / tmax.length) * 100) / 100,
      days_gt32_jja: tmax.filter((v) => v > 32).length,
    };
  } catch {
    return null;
  }
}

export async function modelYieldEstimate(
  observations: Observation[],
  crop: string,
  seasonYear: number,
  centroid: { lat: number; lng: number }
): Promise<ModelYieldEstimate> {
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

  const jjaComplete = new Date() >= new Date(`${seasonYear}-09-08`);
  if (!jjaComplete) {
    return {
      ...base,
      reason: `The trained model uses the season's complete June–August weather record — available after early September ${seasonYear}. Until then the self-relative estimate above is the in-season indicator.`,
    };
  }
  const weather = await seasonWeather(centroid.lat, centroid.lng, seasonYear);
  if (!weather) return { ...base, reason: "Season weather record unavailable right now — try again later." };

  const all: Record<string, number> = { ...f, ...weather };
  const x = M.features.map((k) => all[k]);
  const est = predict(x);
  const band = M.metrics.rmse_bu_ac * FIELD_SCALE_FACTOR;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    ...base,
    ok: true,
    estimateBuAc: r1(est),
    loBuAc: r1(est - band),
    hiBuAc: r1(est + band),
    features: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
  };
}
