/**
 * B4 — specificity-lever CHARACTERIZATION against the 37 backtest patches.
 *
 * The evaluation is FROZEN: same units, same strata, same event dates, same
 * post-scene selection rule, same z ≤ −1.5 gate form. Nothing here tunes the
 * engine — each lever is scored side-by-side with the production baseline and
 * reported as measured, favorable or not. Adopting any lever would require a
 * methodology version bump + re-validation (stated in ENGINES.md).
 *
 * Levers:
 *  1. HARMONIC temporal baseline (annual+semiannual least squares over the 3
 *     baseline years' clear observations) replacing the DOY-kernel expectation
 *     — does a phenology curve separate stress from control better on the
 *     z-gate component?
 *  2. SSURGO soil productivity (NCCPI corn, Soil Data Access): do the control
 *     patches that false-fired sit on poorer soils (i.e., is chronic
 *     soil-driven low vigor being misread as damage)?
 *  3. HLS (Landsat+Sentinel harmonized) availability over these patches —
 *     characterizes the revisit gain; data download is gated on an Earthdata
 *     token (flagged, not worked around).
 *
 * Run: npx tsx scripts/ml/characterize-levers.ts
 */
process.env.TURSO_DATABASE_URL = "";
process.env.NEUMERIC_DB_FILE = ".data/backtest2.db";

import fs from "node:fs";

interface Unit {
  fips: string; county: string; year: number; stratum: string;
  eventDate: string; patchLng: number | null; patchLat: number | null;
}

const Z_GATE = -1.5; // same form as production significance gate
const SIGMA_FLOOR = 0.05; // same floor as production

function shift(iso: string, days: number): string {
  return new Date(new Date(iso + "T12:00:00Z").getTime() + days * 864e5).toISOString().slice(0, 10);
}
function doyOf(iso: string): number {
  const d = new Date(iso);
  return Math.round((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5);
}

/** least squares via normal equations (5 params, tiny) */
function lstsq(X: number[][], y: number[]): number[] | null {
  const p = X[0].length;
  const A: number[][] = Array.from({ length: p }, () => new Array(p + 1).fill(0));
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < p; a++) {
      for (let b = 0; b < p; b++) A[a][b] += X[i][a] * X[i][b];
      A[a][p] += X[i][a] * y[i];
    }
  }
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-9) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= p; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[p] / A[i][i]);
}

function harmonicFeatures(doy: number): number[] {
  const w = (2 * Math.PI * doy) / 365;
  return [1, Math.cos(w), Math.sin(w), Math.cos(2 * w), Math.sin(2 * w)];
}

/** SSURGO nonirrigated land capability class (1=best..8) via Soil Data
 * Access — the NCCPI valu1 table is not exposed through SDA, so capability
 * class is the honest available proxy (stated in the report). */
async function ssurgoNccpi(lng: number, lat: number): Promise<number | null> {
  const sql = `SELECT TOP 1 m2.niccdcd FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(${lng} ${lat})') m JOIN muaggatt m2 ON m2.mukey = m.mukey`;
  try {
    const res = await fetch("https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, format: "JSON" }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { Table?: string[][] };
    const v = j.Table?.[0]?.[0];
    return v != null && v !== "" ? Number(v) : null;
  } catch {
    return null;
  }
}

async function main() {
  const events = JSON.parse(fs.readFileSync("scripts/ml/events-v2.json", "utf8")) as { units: Unit[] };
  const units = events.units.filter((u) => u.patchLng != null && u.stratum !== "excluded");
  const report = JSON.parse(fs.readFileSync("scripts/ml/backtest-v2-report.orig.json", "utf8")) as {
    results: Array<{ fips: string; year: number; stratum: string; ok: boolean; significant: boolean | null; fieldZ: number | null }>;
  };
  const prodByKey = new Map(report.results.map((r) => [`${r.fips}-${r.year}`, r]));

  const { getDb, tables: t } = await import("../../src/db");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();

  // ————— Lever 1: harmonic baseline on the z-gate component —————
  const rows: Array<Record<string, unknown>> = [];
  for (const u of units) {
    const fieldId = `fld_bt2_${u.year}_${u.fips}`;
    const obs = (await db.select().from(t.sceneObservations).where(eq(t.sceneObservations.fieldId, fieldId)))
      .filter((o) => o.clearFrac >= 0.65 && typeof o.stats.ndvi_mean === "number")
      .sort((a, b) => (a.acquiredAt < b.acquiredAt ? -1 : 1));
    // same deterministic post-scene rule as production: worst clear obs in (E, E+30]
    const post = obs
      .filter((o) => o.acquiredAt.slice(0, 10) > u.eventDate && o.acquiredAt.slice(0, 10) <= shift(u.eventDate, 30))
      .sort((a, b) => a.stats.ndvi_mean - b.stats.ndvi_mean || (a.acquiredAt < b.acquiredAt ? -1 : 1))[0];
    const baseObs = obs.filter((o) => o.year < u.year);
    const prod = prodByKey.get(`${u.fips}-${u.year}`);
    if (!post || baseObs.length < 8 || !prod?.ok) {
      rows.push({ ...u, harmonicZ: null, note: !post ? "no post scene" : baseObs.length < 8 ? "baseline too thin for harmonic fit" : "prod unassessable" });
      continue;
    }
    const X = baseObs.map((o) => harmonicFeatures(o.doy));
    const y = baseObs.map((o) => o.stats.ndvi_mean);
    const beta = lstsq(X, y);
    if (!beta) {
      rows.push({ ...u, harmonicZ: null, note: "singular fit" });
      continue;
    }
    const pred = (doy: number) => harmonicFeatures(doy).reduce((s, f, i) => s + f * beta[i], 0);
    const resid = baseObs.map((o) => o.stats.ndvi_mean - pred(o.doy));
    const sigma = Math.max(SIGMA_FLOOR, Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / Math.max(1, resid.length - 5)));
    const harmonicZ = (post.stats.ndvi_mean - pred(doyOf(post.acquiredAt))) / sigma;
    rows.push({
      fips: u.fips, county: u.county, year: u.year, stratum: u.stratum,
      prodZ: prod.fieldZ, harmonicZ: Math.round(harmonicZ * 1000) / 1000,
      prodGate: (prod.fieldZ ?? 0) <= Z_GATE, harmonicGate: harmonicZ <= Z_GATE,
      baselineN: baseObs.length, sigma: Math.round(sigma * 1000) / 1000,
    });
  }

  const gateStats = (which: "prodGate" | "harmonicGate") => {
    const s = rows.filter((r) => String(r.stratum).startsWith("stress") && r[which] != null);
    const c = rows.filter((r) => r.stratum === "control" && r[which] != null);
    return {
      stressCross: `${s.filter((r) => r[which] === true).length}/${s.length}`,
      controlCross: `${c.filter((r) => r[which] === true).length}/${c.length}`,
    };
  };

  // ————— Lever 2: SSURGO NCCPI vs control false fires —————
  const soil: Array<Record<string, unknown>> = [];
  for (const u of units) {
    const prod = prodByKey.get(`${u.fips}-${u.year}`);
    const nccpi = await ssurgoNccpi(u.patchLng!, u.patchLat!);
    soil.push({ fips: u.fips, county: u.county, year: u.year, stratum: u.stratum, fired: prod?.significant ?? null, capabilityClass: nccpi });
    process.stdout.write(".");
  }
  console.log(" ssurgo done");
  const ctrlFired = soil.filter((s) => s.stratum === "control" && s.fired === true && typeof s.capabilityClass === "number").map((s) => s.capabilityClass as number);
  const ctrlQuiet = soil.filter((s) => s.stratum === "control" && s.fired === false && typeof s.capabilityClass === "number").map((s) => s.capabilityClass as number);
  const mean = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 1000) / 1000 : null);

  // ————— Lever 3: HLS availability over one patch, June of a stress year —————
  let hls: Record<string, unknown> = { note: "query failed" };
  try {
    const res = await fetch("https://cmr.earthdata.nasa.gov/stac/LPCLOUD/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collections: ["HLSS30_2.0", "HLSL30_2.0"],
        intersects: { type: "Point", coordinates: [-88.7702, 41.8934] },
        datetime: "2023-06-01T00:00:00Z/2023-07-15T23:59:59Z",
        limit: 100,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const j = (await res.json()) as { features?: Array<{ id: string; collection: string }> };
    const s30 = j.features?.filter((f) => f.collection.startsWith("HLSS30")).length ?? 0;
    const l30 = j.features?.filter((f) => f.collection.startsWith("HLSL30")).length ?? 0;
    hls = {
      window: "2023-06-01..2023-07-15 over DeKalb patch",
      hlsS30Scenes: s30, hlsL30Scenes: l30, combined: s30 + l30,
      sentinelOnlyEquivalent: "~9 (5-day revisit)",
      downloadGate: "LP DAAC data URLs require a (free) NASA Earthdata token — flagged as an access gate, not integrated without it",
    };
  } catch { /* leave note */ }

  const out = {
    ranAt: new Date().toISOString(),
    frozenEvaluation: "same 37 units, strata, event dates, post-scene rule, z≤−1.5 gate form as backtest v2 — characterization only, engine unchanged",
    lever1_harmonicBaseline: {
      method: "annual+semiannual harmonic least squares over 3 baseline years' clear obs (σ floored 0.05), z of same worst post scene",
      production: gateStats("prodGate"),
      harmonic: gateStats("harmonicGate"),
      perUnit: rows,
    },
    lever2_ssurgo: {
      method: "SSURGO nonirrigated land capability class (1=best..8, muaggatt.niccdcd via Soil Data Access) at patch centroid vs control fire status — NCCPI not exposed via SDA, capability class is the available proxy",
      controlFiredMeanCapClass: mean(ctrlFired),
      controlQuietMeanCapClass: mean(ctrlQuiet),
      nFired: ctrlFired.length, nQuiet: ctrlQuiet.length,
      perUnit: soil,
    },
    lever3_hls: hls,
  };
  fs.writeFileSync("scripts/ml/out/lever-characterization.json", JSON.stringify(out, null, 1));
  console.log("\n=== lever 1 (z-gate crossings, stress | control) ===");
  console.log("production:", JSON.stringify(out.lever1_harmonicBaseline.production));
  console.log("harmonic:  ", JSON.stringify(out.lever1_harmonicBaseline.harmonic));
  console.log("=== lever 2 (control NCCPI, fired vs quiet) ===");
  console.log(`fired mean ${out.lever2_ssurgo.controlFiredMeanCapClass} (n=${out.lever2_ssurgo.nFired})  quiet mean ${out.lever2_ssurgo.controlQuietMeanCapClass} (n=${out.lever2_ssurgo.nQuiet})`);
  console.log("=== lever 3 (HLS) ===");
  console.log(JSON.stringify(hls));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
