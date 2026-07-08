/**
 * D1 feature extraction — REAL satellite features for REAL USDA NASS labels.
 *
 * For each (Illinois county, year) unit:
 *   1. Deterministically sample candidate points near the county's interior
 *      centroid (Census gazetteer).
 *   2. Verify crop type at the point + patch corners against the USDA
 *      Cropland Data Layer via the public CropScape service (year-specific —
 *      IL corn/soy rotate, so historical frequency is not enough).
 *   3. For accepted ~25-acre patches, pull the real Sentinel-2 time series
 *      (Earth Search STAC → windowed COG reads → SCL cloud masking) and
 *      compute season NDVI features.
 *
 * Output: JSONL rows {fips, county, year, crop, patch, features...} that
 * train-yield.py joins to NASS county yields. Everything is reproducible:
 * PRNG is seeded per unit, scene ids are recorded per patch.
 *
 * Run:  npx tsx scripts/ml/extract-features.ts [outfile] [concurrency]
 */
import fs from "node:fs";
import path from "node:path";
import proj4 from "proj4";
import { searchScenes } from "../../src/lib/satellite/stac";
import { readScenePixels } from "../../src/lib/satellite/observe";
import { approxRectBoundary } from "../../src/lib/satellite/geo";

const ALBERS =
  "+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs";

// 20 IL counties spread across the state's ag districts (interior-point
// coords from the 2023 Census gazetteer). FIPS are county ANSI codes.
const COUNTIES: Array<{ fips: string; name: string; lat: number; lng: number }> = [
  { fips: "007", name: "BOONE", lat: 42.3231, lng: -88.8236 },
  { fips: "011", name: "BUREAU", lat: 41.4017, lng: -89.5286 },
  { fips: "019", name: "CHAMPAIGN", lat: 40.1398, lng: -88.1993 },
  { fips: "037", name: "DE KALB", lat: 41.8934, lng: -88.7702 },
  { fips: "053", name: "FORD", lat: 40.5973, lng: -88.2233 },
  { fips: "073", name: "HENRY", lat: 41.3536, lng: -90.1313 },
  { fips: "089", name: "KANE", lat: 41.9391, lng: -88.4287 },
  { fips: "093", name: "KENDALL", lat: 41.5906, lng: -88.4288 },
  { fips: "095", name: "KNOX", lat: 40.9319, lng: -90.2132 },
  { fips: "099", name: "LA SALLE", lat: 41.3440, lng: -88.8859 },
  { fips: "103", name: "LEE", lat: 41.7462, lng: -89.3005 },
  { fips: "105", name: "LIVINGSTON", lat: 40.8916, lng: -88.5578 },
  { fips: "113", name: "MC LEAN", lat: 40.4906, lng: -88.8443 },
  { fips: "115", name: "MACON", lat: 39.8600, lng: -88.9615 },
  { fips: "123", name: "MARSHALL", lat: 41.0331, lng: -89.3447 },
  { fips: "137", name: "MORGAN", lat: 39.7156, lng: -90.2013 },
  { fips: "147", name: "PIATT", lat: 40.0104, lng: -88.5911 },
  { fips: "167", name: "SANGAMON", lat: 39.7581, lng: -89.6580 },
  { fips: "195", name: "WHITESIDE", lat: 41.7561, lng: -89.9139 },
  { fips: "203", name: "WOODFORD", lat: 40.7882, lng: -89.2112 },
];

const YEARS = [2019, 2020, 2021, 2022, 2023];
const CROP = { name: "corn", cdlClass: 1 };
const PATCHES_PER_UNIT = 2;
const MAX_CANDIDATES = 14;
const PATCH_ACRES = 25;
const MAX_SCENES = 9;

// deterministic PRNG (mulberry32) seeded per unit — reruns sample identically
function rng(seed: string): () => number {
  let h = 1779033703;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

async function cdlValue(year: number, lng: number, lat: number): Promise<number | null> {
  const [x, y] = proj4("EPSG:4326", ALBERS, [lng, lat]);
  const url = `https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLValue?year=${year}&x=${x.toFixed(1)}&y=${y.toFixed(1)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      const text = await res.text();
      const m = text.match(/value:\s*(\d+)/);
      if (m) return Number(m[1]);
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  return null;
}

/** Patch must be the target crop at center and two diagonal offsets (±120 m). */
async function isCropPatch(year: number, lng: number, lat: number, cls: number): Promise<boolean> {
  const dLat = 120 / 111_320;
  const dLng = 120 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const checks = [
    [lng, lat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ] as const;
  for (const [cx, cy] of checks) {
    const v = await cdlValue(year, cx, cy);
    if (v !== cls) return false;
  }
  return true;
}

interface UnitRow {
  fips: string;
  county: string;
  year: number;
  crop: string;
  patchLng: number;
  patchLat: number;
  sceneIds: string[];
  nObs: number;
  coverage: number;
  ndviIntegral: number;
  ndviPeak: number;
  peakDoy: number;
  ndviEarly: number | null; // DOY 140-180 mean (emergence/early vegetative)
  ndviMid: number | null; // DOY 181-240 mean (peak canopy / grain fill)
  ndviLate: number | null; // DOY 241-285 mean (senescence)
}

async function extractPatch(
  year: number,
  lng: number,
  lat: number
): Promise<Omit<UnitRow, "fips" | "county" | "year" | "crop" | "patchLng" | "patchLat"> | null> {
  const boundary = approxRectBoundary(lng, lat, PATCH_ACRES);
  const scenes = await searchScenes(boundary, `${year}-05-01`, `${year}-10-10`);
  // evenly thin to MAX_SCENES across the window, preferring low scene cloud
  const usable = scenes.filter((s) => (s.cloudCover ?? 100) < 40);
  const step = Math.max(1, Math.floor(usable.length / MAX_SCENES));
  const picked = usable.filter((_, i) => i % step === 0).slice(0, MAX_SCENES);

  const pts: Array<{ doy: number; ndvi: number }> = [];
  const sceneIds: string[] = [];
  for (const scene of picked) {
    try {
      const px = await readScenePixels(boundary, scene, "core");
      if (px.clearFrac < 0.55) continue;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < px.ndvi.length; i++) {
        if (px.fieldMask[i] && px.clearMask[i] && Number.isFinite(px.ndvi[i])) {
          sum += px.ndvi[i];
          n++;
        }
      }
      if (n < 50) continue;
      const doy = Math.floor(
        (Date.parse(scene.datetime) - Date.parse(`${year}-01-01`)) / 86_400_000
      );
      pts.push({ doy, ndvi: sum / n });
      sceneIds.push(scene.id);
    } catch {
      // scene read failed after retries — skip it, coverage reflects the gap
    }
  }
  if (pts.length < 4) return null;
  pts.sort((a, b) => a.doy - b.doy);

  let area = 0;
  for (let i = 1; i < pts.length; i++) {
    area += ((pts[i].ndvi + pts[i - 1].ndvi) / 2) * (pts[i].doy - pts[i - 1].doy);
  }
  const span = pts[pts.length - 1].doy - pts[0].doy;
  if (span < 60) return null;
  const peak = pts.reduce((a, b) => (b.ndvi > a.ndvi ? b : a));
  const phase = (lo: number, hi: number) => {
    const v = pts.filter((p) => p.doy >= lo && p.doy <= hi);
    return v.length ? v.reduce((s, p) => s + p.ndvi, 0) / v.length : null;
  };
  return {
    sceneIds,
    nObs: pts.length,
    coverage: span / (283 - 121),
    ndviIntegral: area / span,
    ndviPeak: peak.ndvi,
    peakDoy: peak.doy,
    ndviEarly: phase(140, 180),
    ndviMid: phase(181, 240),
    ndviLate: phase(241, 285),
  };
}

async function processUnit(c: (typeof COUNTIES)[0], year: number): Promise<UnitRow[]> {
  const rand = rng(`${c.fips}-${year}-${CROP.name}`);
  const rows: UnitRow[] = [];
  let candidates = 0;
  while (rows.length < PATCHES_PER_UNIT && candidates < MAX_CANDIDATES) {
    candidates++;
    const lng = c.lng + (rand() - 0.5) * 0.2;
    const lat = c.lat + (rand() - 0.5) * 0.16;
    if (!(await isCropPatch(year, lng, lat, CROP.cdlClass))) continue;
    const f = await extractPatch(year, lng, lat);
    if (!f) continue;
    rows.push({
      fips: c.fips,
      county: c.name,
      year,
      crop: CROP.name,
      patchLng: Math.round(lng * 1e5) / 1e5,
      patchLat: Math.round(lat * 1e5) / 1e5,
      ...f,
    });
    console.log(
      `  ${c.name} ${year} patch ${rows.length}: integral=${f.ndviIntegral.toFixed(3)} peak=${f.ndviPeak.toFixed(2)}@${f.peakDoy} obs=${f.nObs}`
    );
  }
  if (rows.length === 0) console.log(`  ${c.name} ${year}: no usable patches (${candidates} candidates)`);
  return rows;
}

async function main() {
  const outfile = process.argv[2] ?? "scripts/ml/features.jsonl";
  const concurrency = Number(process.argv[3] ?? 4);
  fs.mkdirSync(path.dirname(outfile), { recursive: true });

  // resume support: skip units already in the file
  const done = new Set<string>();
  if (fs.existsSync(outfile)) {
    for (const line of fs.readFileSync(outfile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as UnitRow;
      done.add(`${r.fips}-${r.year}`);
    }
  }

  const units: Array<{ c: (typeof COUNTIES)[0]; year: number }> = [];
  for (const c of COUNTIES) for (const year of YEARS) if (!done.has(`${c.fips}-${year}`)) units.push({ c, year });
  console.log(`${units.length} county-year units to extract (${done.size} already done), concurrency ${concurrency}`);

  const out = fs.createWriteStream(outfile, { flags: "a" });
  let i = 0;
  async function worker() {
    while (i < units.length) {
      const u = units[i++];
      console.log(`[${i}/${units.length}] ${u.c.name} ${u.year}`);
      try {
        const rows = await processUnit(u.c, u.year);
        for (const r of rows) out.write(JSON.stringify(r) + "\n");
      } catch (e) {
        console.error(`  ${u.c.name} ${u.year} failed: ${e}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  out.end();
  console.log("done");
}

main();
