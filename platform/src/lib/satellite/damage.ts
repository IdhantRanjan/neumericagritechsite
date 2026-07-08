/**
 * Damage quantification by change detection — the analyzer that replaces
 * the demo stub as the primary path for real operations.
 *
 * A damage event is quantified as a statistically significant negative NDVI
 * deviation against BOTH baselines:
 *   1. temporal — the field's own same-DOY expectation from prior seasons
 *   2. spatial — the surrounding region's contemporaneous change (so a
 *      region-wide drought isn't misread as localized hail, and vice versa)
 *
 * Everything is deterministic under METHODOLOGY_VERSION: same field, same
 * event date, same available scenes ⇒ identical output. The full trace
 * (scenes, hashes, baselines, thresholds) rides along in the result.
 */
import type { Field, GeoJSONPolygon } from "@/db/schema";
import type { DB } from "@/db";
import { METHODOLOGY_VERSION, PARAMS, PARAMS_HASH } from "./methodology";
import { maskToMultiPolygon } from "./geo";
import { searchScenes, type SceneRef } from "./stac";
import { readScenePixels } from "./observe";
import { scanField, getObservations } from "./scan";
import { temporalBaseline, regionalDelta, type TemporalBaseline, type RegionalDelta } from "./baseline";

const ACRES_PER_PX = (PARAMS.grid.resolutionM * PARAMS.grid.resolutionM) / 4046.8564224;

export interface DamageAssessment {
  ok: boolean;
  reason?: string; // populated when assessment is not possible (honesty > guessing)
  eventDate: string;
  significant: boolean;
  extent: "localized" | "region-wide" | "none";
  persistence: "persistent" | "transient" | "unconfirmed";
  conditionClass: "healthy" | "stressed" | "damaged" | "destroyed";
  severityPct: number; // mean relative NDVI loss over affected pixels, 0–100
  affectedFrac: number;
  affectedAcres: number;
  affectedArea: ReturnType<typeof maskToMultiPolygon>;
  confidence: number; // heuristic v1 — formula in docs/ENGINES.md, NOT calibrated yet
  confidenceFactors: { clear: number; baseline: number; effect: number };
  metrics: Record<string, number>;
  narrative: string;
  trace: {
    methodologyVersion: string;
    paramsHash: string;
    preScene: { id: string; datetime: string; refHash: string } | null;
    postScene: { id: string; datetime: string; refHash: string } | null;
    temporalBaseline: TemporalBaseline | null;
    regional: RegionalDelta | null;
    scenesConsidered: number;
  };
}

function doyOf(dateIso: string): number {
  const d = new Date(dateIso + (dateIso.length === 10 ? "T12:00:00Z" : ""));
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (dateIso: string, days: number) => {
  const d = new Date(dateIso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};

function fail(eventDate: string, reason: string, scenesConsidered = 0): DamageAssessment {
  return {
    ok: false,
    reason,
    eventDate,
    significant: false,
    extent: "none",
    persistence: "unconfirmed",
    conditionClass: "healthy",
    severityPct: 0,
    affectedFrac: 0,
    affectedAcres: 0,
    affectedArea: null,
    confidence: 0,
    confidenceFactors: { clear: 0, baseline: 0, effect: 0 },
    metrics: {},
    narrative: reason,
    trace: {
      methodologyVersion: METHODOLOGY_VERSION,
      paramsHash: PARAMS_HASH,
      preScene: null,
      postScene: null,
      temporalBaseline: null,
      regional: null,
      scenesConsidered,
    },
  };
}

/**
 * Ensure the observations needed for this event exist, then assess.
 * `scan: false` skips ingestion (pure re-evaluation of stored data).
 */
export async function detectDamage(
  db: DB,
  field: Field,
  eventDate: string, // YYYY-MM-DD
  opts: { scan?: boolean } = {}
): Promise<DamageAssessment> {
  if (!field.boundary) return fail(eventDate, "Field has no boundary polygon — add one to enable satellite analysis.");
  const boundary: GeoJSONPolygon = field.boundary;
  const D = PARAMS.detection;
  const eventYear = Number(eventDate.slice(0, 4));
  const eventDoy = doyOf(eventDate);

  // 1. Ingest the needed windows (current season around event + prior years around same DOY)
  if (opts.scan !== false) {
    await scanField(db, field, shift(eventDate, -D.preEventWindowDays), shift(eventDate, D.postEventWindowDays));
    for (let y = 1; y <= D.baselineYears; y++) {
      const anchor = `${eventYear - y}${eventDate.slice(4)}`;
      await scanField(db, field, shift(anchor, -(D.baselineDoyWindow + 6)), shift(anchor, D.baselineDoyWindow + 6), {
        maxScenes: 12,
      });
    }
  }

  // 2. Pick pre/post observations from stored, clear-enough scenes
  const obs = await getObservations(db, field.id);
  const clearObs = obs.filter((o) => o.clearFrac >= PARAMS.masking.minClearFrac);
  const preObs = clearObs
    .filter((o) => o.acquiredAt.slice(0, 10) <= eventDate && o.acquiredAt.slice(0, 10) >= shift(eventDate, -D.preEventWindowDays))
    .at(-1);
  // Post scene = the WORST clear observation in the window (claims document
  // the condition at its worst; persistence is assessed separately below).
  // Deterministic: min ndvi_mean, ties broken by earlier date.
  const postCandidates = clearObs.filter(
    (o) => o.acquiredAt.slice(0, 10) > eventDate && o.acquiredAt.slice(0, 10) <= shift(eventDate, D.postEventWindowDays)
  );
  const postObs = postCandidates
    .filter((o) => typeof o.stats.ndvi_mean === "number")
    .sort((a, b) => a.stats.ndvi_mean - b.stats.ndvi_mean || (a.acquiredAt < b.acquiredAt ? -1 : 1))[0];
  if (!preObs) return fail(eventDate, `No clear pre-event scene within ${D.preEventWindowDays} days before the event (clouds or no coverage). Cannot establish the field's pre-event condition.`, obs.length);
  if (!postObs) return fail(eventDate, `No clear post-event scene within ${D.postEventWindowDays} days after the event yet. Re-run when the next clear Sentinel-2 pass occurs (~2–5 days).`, obs.length);

  // 3. Re-resolve the exact scenes via STAC (hrefs aren't stored; ids are)
  const candidates = await searchScenes(boundary, shift(eventDate, -D.preEventWindowDays), shift(eventDate, D.postEventWindowDays));
  const preScene = candidates.find((s) => s.id === preObs.sceneId);
  const postScene = candidates.find((s) => s.id === postObs.sceneId);
  if (!preScene || !postScene) return fail(eventDate, "Stored observation scenes no longer resolvable in STAC (upstream catalog change).", candidates.length);
  if (preScene.epsg !== postScene.epsg) return fail(eventDate, "Pre/post scenes fall in different UTM zones; per-pixel comparison unavailable for this field position.", candidates.length);
  if (preScene.refHash !== preObs.sceneRefHash || postScene.refHash !== postObs.sceneRefHash)
    return fail(eventDate, "Scene reference hash mismatch — upstream assets changed since observation; re-scan required.", candidates.length);

  // 4. Pixel-level pre/post + regional baseline
  const [pre, post, regional] = await Promise.all([
    readScenePixels(boundary, preScene, "full"),
    readScenePixels(boundary, postScene, "full"),
    regionalDelta(boundary, preScene, postScene),
  ]);

  // 5. Temporal baseline from prior seasons
  const baseline = temporalBaseline(obs, doyOf(postObs.acquiredAt), eventYear);

  // 5b. Persistence: does the NEXT clear observation after the chosen post
  // scene remain significantly below its own-date expectation, or has the
  // field recovered? Both answers are evidence — acute-but-transient stress
  // (early-stage drought a rain repaired) reads differently to an adjuster
  // than persistent canopy loss (hail/flood kill).
  const followObs = clearObs.find(
    (o) => o.acquiredAt > postObs.acquiredAt && typeof o.stats.ndvi_mean === "number"
  );
  let persistence: "persistent" | "transient" | "unconfirmed" = "unconfirmed";
  let followZ: number | null = null;
  if (followObs) {
    const fb = temporalBaseline(obs, followObs.doy, eventYear);
    followZ =
      fb.mean != null && fb.sigma != null ? (followObs.stats.ndvi_mean - fb.mean) / fb.sigma : null;
    persistence = followZ != null && followZ <= D.fieldZSignificant ? "persistent" : "transient";
  }

  // 6. Per-pixel classification on the shared grid — two detection paths:
  //    ACUTE (hail/flood/wind): pixel NDVI *dropped* pre→post beyond both the
  //      absolute floor and the regional change.
  //    DEFICIT (drought/disease): pixel NDVI sits far below the field's own
  //      same-date multi-year expectation, even if it grew since pre-event
  //      (slow-onset damage suppresses growth rather than reversing it).
  const n = pre.grid.width * pre.grid.height;
  const affectedMask = new Uint8Array(n);
  const regionalMedianDelta = regional.delta ?? 0;
  const dropFloor = Math.min(-D.minAbsoluteDrop, regionalMedianDelta - D.regionalMargin);
  const deficitFloor =
    baseline.mean != null && baseline.sigma != null
      ? baseline.mean - Math.max(2 * baseline.sigma, 0.15)
      : null;
  let comparable = 0,
    affected = 0,
    acutePx = 0,
    deficitPx = 0,
    sevSum = 0,
    preSum = 0,
    postSum = 0;
  for (let i = 0; i < n; i++) {
    if (!pre.fieldMask[i] || !pre.clearMask[i] || !post.clearMask[i]) continue;
    const a = pre.ndvi[i],
      b = post.ndvi[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    comparable++;
    preSum += a;
    postSum += b;
    const delta = b - a;
    const acute = delta < dropFloor;
    const deficit = deficitFloor != null && b < deficitFloor;
    if (acute) acutePx++;
    if (deficit) deficitPx++;
    if (acute || deficit) {
      affected++;
      affectedMask[i] = 1;
      const sevAcute = acute ? -delta / Math.max(a, D.minPreNdviForSeverity) : 0;
      const sevDeficit =
        deficit && baseline.mean != null
          ? (baseline.mean - b) / Math.max(baseline.mean, D.minPreNdviForSeverity)
          : 0;
      sevSum += Math.min(1, Math.max(0, Math.max(sevAcute, sevDeficit)));
    }
  }
  if (comparable < 30)
    return fail(eventDate, `Only ${comparable} pixels are clear in both pre and post scenes — not enough for a defensible assessment.`, candidates.length);

  const preMean = preSum / comparable;
  const postMean = postSum / comparable;
  const affectedFrac = affected / comparable;
  const severity = affected > 0 ? sevSum / affected : 0;
  const fieldZ =
    baseline.mean != null && baseline.sigma != null ? (postMean - baseline.mean) / baseline.sigma : null;

  // 7. Significance & extent
  const belowExpectation = fieldZ != null ? fieldZ <= D.fieldZSignificant : postMean < preMean - 0.15;
  const localizedGap =
    regional.delta != null ? postMean - preMean < regional.delta - D.regionalMargin : affectedFrac >= 0.15;
  const significant = (belowExpectation && affectedFrac >= 0.05) || (localizedGap && affectedFrac >= 0.15);
  const extent: DamageAssessment["extent"] = !significant
    ? "none"
    : localizedGap
    ? "localized"
    : "region-wide";
  const acuteFrac = comparable > 0 ? acutePx / comparable : 0;
  const deficitFrac = comparable > 0 ? deficitPx / comparable : 0;

  const severityPct = Math.round(severity * 100);
  const conditionClass: DamageAssessment["conditionClass"] = !significant
    ? "healthy"
    : severityPct >= 80 && affectedFrac >= 0.6
    ? "destroyed"
    : severityPct >= 25 || affectedFrac >= 0.3
    ? "damaged"
    : "stressed";

  // 8. Heuristic confidence v1 (documented, NOT calibrated — see docs/ENGINES.md)
  const clear = Math.min(pre.clearFrac, post.clearFrac);
  const baseFac = baseline.n >= D.minBaselineObs ? Math.min(1, baseline.n / 6) : 0.3;
  const effFac = fieldZ != null ? Math.min(1, Math.abs(fieldZ) / 3) : Math.min(1, affectedFrac * 2);
  // capped below 1: a single-sensor optical method never warrants claimed certainty
  const confidence = Math.min(
    0.95,
    Math.round(clear * (0.4 + 0.6 * baseFac) * (0.5 + 0.5 * effFac) * 100) / 100
  );

  const r4 = (x: number | null) => (x == null ? NaN : Math.round(x * 10000) / 10000);
  const metrics: Record<string, number> = {
    ndvi_pre_mean: r4(preMean),
    ndvi_post_mean: r4(postMean),
    ndvi_delta_field: r4(postMean - preMean),
    ndvi_delta_region: r4(regional.delta),
    ndvi_expected_doy: r4(baseline.mean),
    ndvi_sigma_doy: r4(baseline.sigma),
    field_z_score: r4(fieldZ),
    affected_frac: r4(affectedFrac),
    acute_drop_frac: r4(acuteFrac),
    expectation_deficit_frac: r4(deficitFrac),
    severity_mean: r4(severity),
    clear_frac_pre: r4(pre.clearFrac),
    clear_frac_post: r4(post.clearFrac),
    water_frac_pre: r4(pre.waterFrac),
    water_frac_post: r4(post.waterFrac),
    baseline_obs_n: baseline.n,
    comparable_pixels: comparable,
    follow_up_z_score: r4(followZ),
  };

  const fmtD = (s: string) => s.slice(0, 10);
  const narrative = significant
    ? `Sentinel-2 change detection: between ${fmtD(preScene.datetime)} and ${fmtD(postScene.datetime)}, ` +
      `mean field NDVI moved ${(postMean - preMean).toFixed(2)} (${preMean.toFixed(2)} → ${postMean.toFixed(2)}) ` +
      `while the surrounding ${PARAMS.grid.regionRingM / 1000} km region moved ${regional.delta?.toFixed(2) ?? "n/a"}. ` +
      (baseline.mean != null
        ? `The field's own ${baseline.yearsUsed.join("/")} same-date expectation is ${baseline.mean.toFixed(2)} (σ ${baseline.sigma?.toFixed(2)}); this observation sits ${fieldZ?.toFixed(1)}σ below it. `
        : `No multi-year baseline available for this field yet (${baseline.n} prior observations). `) +
      `${Math.round(affectedFrac * 100)}% of comparable pixels are affected ` +
      `(${Math.round(acuteFrac * 100)}% acute pre→post drop, ${Math.round(deficitFrac * 100)}% below multi-year expectation), ` +
      `${extent} pattern, mean relative severity ${severityPct}%. ` +
      (persistence === "persistent"
        ? `The deficit persists in the next clear pass (${followObs?.acquiredAt.slice(0, 10)}, ${followZ?.toFixed(1)}σ below expectation).`
        : persistence === "transient"
        ? `The next clear pass (${followObs?.acquiredAt.slice(0, 10)}) shows recovery toward expectation (${followZ?.toFixed(1)}σ) — condition at its worst was transient, which matters for how the loss developed.`
        : `No later clear pass yet to confirm persistence — re-run after the next Sentinel-2 overpass.`)
    : `No statistically significant field-level decline detected relative to the field's own history and the surrounding region for this window.`;

  return {
    ok: true,
    eventDate,
    significant,
    extent,
    persistence,
    conditionClass,
    severityPct,
    affectedFrac: Math.round(affectedFrac * 10000) / 10000,
    affectedAcres: Math.round(affected * ACRES_PER_PX * 10) / 10,
    affectedArea: significant ? maskToMultiPolygon(pre.grid, affectedMask) : null,
    confidence,
    confidenceFactors: {
      clear: Math.round(clear * 100) / 100,
      baseline: Math.round(baseFac * 100) / 100,
      effect: Math.round(effFac * 100) / 100,
    },
    metrics,
    narrative,
    trace: {
      methodologyVersion: METHODOLOGY_VERSION,
      paramsHash: PARAMS_HASH,
      preScene: { id: preScene.id, datetime: preScene.datetime, refHash: preScene.refHash },
      postScene: { id: postScene.id, datetime: postScene.datetime, refHash: postScene.refHash },
      temporalBaseline: baseline,
      regional,
      scenesConsidered: candidates.length,
    },
  };
}
