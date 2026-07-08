/**
 * Parametric trigger engine (Hard Core 5).
 *
 * Everything a carrier would need to trust — and nothing a carrier would
 * have to be: Neumeric defines and evaluates triggers; a LICENSED CARRIER
 * prices, underwrites, and pays (docs/DEPENDENCIES.md §5). There is no
 * premium or rate math anywhere in this module by design.
 *
 * Determinism contract:
 *  - A trigger definition pins metric, comparator, threshold, consecutive-
 *    observation count, imagery source class, minimum clear fraction, AND
 *    the analysis methodology version — all hashed (canonical JSON, sha256)
 *    into `methodologyHash`.
 *  - An evaluation reads ONLY stored scene observations (append-only,
 *    provenance-hashed) inside the window and applies the pinned rule.
 *    Same definition + same observation set ⇒ byte-identical trace.
 *  - Every evaluation is written to trigger_evaluations AND committed into
 *    the provenance hash chain, so "why did/didn't it pay" is answerable
 *    years later from the stored trace alone.
 *
 * Basis-risk differentiator: evaluateWeatherCounterpart() computes what a
 * weather-index product (Arbol/Descartes-style) would have seen over the
 * same window — rainfall vs the location's own 10-year normal via
 * Open-Meteo (free archive API; commercial licensing flagged in docs).
 * The CV-vs-weather disagreement matrix IS the basis-risk gap, made visible.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { tables as t, type DB } from "@/db";
import type { Field } from "@/db/schema";
import { METHODOLOGY_VERSION, canonicalJson, sha256 } from "@/lib/satellite/methodology";
import { getObservations } from "@/lib/satellite/scan";
import { appendProvenance } from "@/lib/provenance";

export interface TriggerMethodology {
  metric: string; // scene-observation stat key, e.g. "ndvi_mean"
  comparator: "lt" | "gt";
  threshold: number;
  consecutiveObservations: number;
  minClearFrac: number;
  imagerySourceClass: "satellite";
  analysisMethodologyVersion: string; // pins the observation pipeline itself
}

export function defaultDroughtStressMethodology(threshold = 0.35): TriggerMethodology {
  return {
    metric: "ndvi_mean",
    comparator: "lt",
    threshold,
    consecutiveObservations: 2,
    minClearFrac: 0.6,
    imagerySourceClass: "satellite",
    analysisMethodologyVersion: METHODOLOGY_VERSION,
  };
}

export function methodologyHash(m: TriggerMethodology): string {
  return sha256(canonicalJson(m));
}

export interface TriggerEvaluationResult {
  evaluationId: string;
  fired: boolean;
  computedValue: number; // worst breach run length observed
  window: { from: string; to: string };
  methodology: TriggerMethodology;
  methodologyHash: string;
  trace: {
    observationsConsidered: Array<{
      sceneId: string;
      date: string;
      value: number | null;
      clearFrac: number;
      usable: boolean;
      breach: boolean;
    }>;
    rule: string;
    firingRun: string[] | null; // scene ids of the consecutive run that fired
  };
  provenanceSeq: number;
}

/** Deterministic evaluation over stored observations. Persists row + chain entry. */
export async function evaluateTrigger(
  db: DB,
  field: Field,
  definitionId: string,
  m: TriggerMethodology,
  fromIso: string,
  toIso: string
): Promise<TriggerEvaluationResult> {
  const mHash = methodologyHash(m);
  const obs = await getObservations(db, field.id, fromIso, toIso);

  const considered = obs.map((o) => {
    const value = typeof o.stats[m.metric] === "number" ? o.stats[m.metric] : null;
    const usable = o.clearFrac >= m.minClearFrac && value != null;
    const breach =
      usable && (m.comparator === "lt" ? (value as number) < m.threshold : (value as number) > m.threshold);
    return {
      sceneId: o.sceneId,
      date: o.acquiredAt.slice(0, 10),
      value,
      clearFrac: o.clearFrac,
      usable,
      breach,
    };
  });

  // longest run of consecutive USABLE observations that all breach
  let run: string[] = [];
  let bestRun: string[] = [];
  for (const c of considered) {
    if (!c.usable) continue; // cloudy scenes neither extend nor break a run — stated rule
    if (c.breach) {
      run = [...run, c.sceneId];
      if (run.length > bestRun.length) bestRun = run;
    } else {
      run = [];
    }
  }
  const fired = bestRun.length >= m.consecutiveObservations;

  const evaluationId = `tev_${randomUUID().slice(0, 10)}`;
  const trace = {
    observationsConsidered: considered,
    rule: `${m.metric} ${m.comparator === "lt" ? "<" : ">"} ${m.threshold} on ${m.consecutiveObservations} consecutive clear (≥${m.minClearFrac * 100}%) observations within window`,
    firingRun: fired ? bestRun.slice(0, m.consecutiveObservations) : null,
  };

  const def = (
    await db.select().from(t.triggerDefinitions).where(eq(t.triggerDefinitions.id, definitionId))
  )[0];
  await db.insert(t.triggerEvaluations).values({
    id: evaluationId,
    triggerDefinitionId: definitionId,
    definitionVersion: def?.version ?? 1,
    inputFcrIds: [], // evaluations read scene observations directly
    computedValue: bestRun.length,
    fired,
    calculationTrace: { window: { from: fromIso, to: toIso }, methodology: m, methodologyHash: mHash, ...trace },
    evaluatedAt: new Date().toISOString(),
  });
  const prov = await appendProvenance(db, "trigger_evaluation", evaluationId, "evaluated", {
    definitionId,
    methodologyHash: mHash,
    window: { from: fromIso, to: toIso },
    fired,
    firingRun: trace.firingRun,
    observations: considered,
  });

  return {
    evaluationId,
    fired,
    computedValue: bestRun.length,
    window: { from: fromIso, to: toIso },
    methodology: m,
    methodologyHash: mHash,
    trace,
    provenanceSeq: prov.seq,
  };
}

// ————— Weather-index counterpart (the basis-risk comparison) —————

export interface WeatherCounterpart {
  ok: boolean;
  reason?: string;
  windowPrecipMm: number | null;
  normalPrecipMm: number | null; // same calendar window, prior 10 years, mean
  ratioToNormal: number | null;
  weatherFired: boolean | null; // rainfall-deficit rule: < 60% of normal
  rule: string;
  source: string;
}

async function precipSum(lat: number, lng: number, from: string, to: string): Promise<number | null> {
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&start_date=${from}&end_date=${to}&daily=precipitation_sum&timezone=UTC`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = (await res.json()) as { daily?: { precipitation_sum?: Array<number | null> } };
  const vals = j.daily?.precipitation_sum?.filter((v): v is number => v != null);
  if (!vals || vals.length === 0) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) * 10) / 10;
}

export async function evaluateWeatherCounterpart(
  field: Field,
  fromIso: string,
  toIso: string
): Promise<WeatherCounterpart> {
  const rule = "rainfall-deficit index: window precipitation < 60% of the same-window 10-year normal";
  const source = "Open-Meteo ERA5 archive (free tier — commercial data licensing flagged in docs/DEPENDENCIES.md §8)";
  if (!field.boundary)
    return { ok: false, reason: "no boundary", windowPrecipMm: null, normalPrecipMm: null, ratioToNormal: null, weatherFired: null, rule, source };
  const ring = field.boundary.coordinates[0];
  const lng = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const lat = ring.reduce((a, p) => a + p[1], 0) / ring.length;

  const windowPrecip = await precipSum(lat, lng, fromIso, toIso);
  const year = Number(fromIso.slice(0, 4));
  const normals: number[] = [];
  for (let y = year - 10; y < year; y++) {
    const v = await precipSum(lat, lng, `${y}${fromIso.slice(4)}`, `${y}${toIso.slice(4)}`);
    if (v != null) normals.push(v);
  }
  if (windowPrecip == null || normals.length < 5)
    return {
      ok: false,
      reason: "weather archive unavailable or insufficient normal-period coverage",
      windowPrecipMm: windowPrecip,
      normalPrecipMm: null,
      ratioToNormal: null,
      weatherFired: null,
      rule,
      source,
    };
  const normal = normals.reduce((a, b) => a + b, 0) / normals.length;
  const ratio = windowPrecip / normal;
  return {
    ok: true,
    windowPrecipMm: windowPrecip,
    normalPrecipMm: Math.round(normal * 10) / 10,
    ratioToNormal: Math.round(ratio * 100) / 100,
    weatherFired: ratio < 0.6,
    rule,
    source,
  };
}

/** The gap classification — the concrete basis-risk artifact. */
export function basisRiskGap(cvFired: boolean, weatherFired: boolean | null) {
  if (weatherFired == null) return { gap: "weather-unavailable" as const, story: "Weather index could not be computed for this window." };
  if (cvFired && weatherFired) return { gap: "agree-fired" as const, story: "Both the field's actual condition and the weather index fired — a weather-index product would also have paid here." };
  if (!cvFired && !weatherFired) return { gap: "agree-quiet" as const, story: "Neither fired — no loss signal in the field or the weather index." };
  if (cvFired && !weatherFired)
    return {
      gap: "cv-only" as const,
      story:
        "THE BASIS-RISK CASE: this field shows verified damage while the weather index stayed quiet — a weather-index policy would NOT have paid this farmer. Field-level verification closes exactly this gap.",
    };
  return {
    gap: "weather-only" as const,
    story:
      "The weather index fired but the field itself held up — an index product would pay here without a real loss (over-payment risk a carrier eats, and prices into everyone's premium).",
  };
}
