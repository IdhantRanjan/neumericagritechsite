/**
 * Backtest v2 — event-set builder. Implements design-backtest-v2.md exactly:
 * USDM strata, deterministic event dates, rotation-consistent CDL patches
 * (corn in event year at 3 points AND corn at center in all 3 baseline
 * years). RMA cause-of-loss drought indemnity attached as corroboration.
 *
 * Run: npx tsx scripts/ml/build-event-set.ts <colDir> [out=scripts/ml/events-v2.json] [concurrency=4]
 */
import fs from "node:fs";
import proj4 from "proj4";

const ALBERS =
  "+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs";

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
  { fips: "099", name: "LA SALLE", lat: 41.344, lng: -88.8859 },
  { fips: "103", name: "LEE", lat: 41.7462, lng: -89.3005 },
  { fips: "105", name: "LIVINGSTON", lat: 40.8916, lng: -88.5578 },
  { fips: "113", name: "MC LEAN", lat: 40.4906, lng: -88.8443 },
  { fips: "115", name: "MACON", lat: 39.86, lng: -88.9615 },
  { fips: "123", name: "MARSHALL", lat: 41.0331, lng: -89.3447 },
  { fips: "137", name: "MORGAN", lat: 39.7156, lng: -90.2013 },
  { fips: "147", name: "PIATT", lat: 40.0104, lng: -88.5911 },
  { fips: "167", name: "SANGAMON", lat: 39.7581, lng: -89.658 },
  { fips: "195", name: "WHITESIDE", lat: 41.7561, lng: -89.9139 },
  { fips: "203", name: "WOODFORD", lat: 40.7882, lng: -89.2112 },
];
const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const WINDOW = { fromMonthDay: "06-01", toMonthDay: "08-15" };

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

// ————— USDM weekly county stats (cumulative % area per class) —————

interface UsdmWeek { validStart: string; d1plus: number; d2plus: number }

async function usdmWeeks(fips5: string): Promise<UsdmWeek[]> {
  const url =
    `https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent` +
    `?aoi=${fips5}&startdate=1/1/2019&enddate=12/31/2025&statisticsType=1`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { Accept: "text/csv" } });
      const text = await res.text();
      const lines = text.trim().split("\n");
      const header = lines[0].split(",");
      const col = (name: string) => header.indexOf(name);
      const out: UsdmWeek[] = [];
      for (const line of lines.slice(1)) {
        const f = line.split(",");
        out.push({
          validStart: f[col("ValidStart")],
          d1plus: Number(f[col("D1")]), // cumulative: D1 column = % area in D1 or worse
          d2plus: Number(f[col("D2")]),
        });
      }
      return out.sort((a, b) => (a.validStart < b.validStart ? -1 : 1));
    } catch {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new Error(`USDM fetch failed for ${fips5}`);
}

function classify(weeks: UsdmWeek[], year: number) {
  const from = `${year}-${WINDOW.fromMonthDay}`;
  const to = `${year}-${WINDOW.toMonthDay}`;
  const w = weeks.filter((x) => x.validStart >= from && x.validStart <= to);
  if (w.length < 8) return { stratum: "excluded" as const, reason: "incomplete USDM window", peak: null };
  const maxD2 = Math.max(...w.map((x) => x.d2plus));
  const maxD1 = Math.max(...w.map((x) => x.d1plus));
  if (maxD2 >= 25) {
    const peak = w.reduce((a, b) => (b.d2plus > a.d2plus ? b : a));
    return { stratum: "stress_strong" as const, reason: `maxD2+=${maxD2.toFixed(0)}%`, peak: peak.validStart };
  }
  // ≥3 consecutive weeks with D1+ = 100
  let run = 0;
  let runStart: string | null = null;
  for (const x of w) {
    if (x.d1plus >= 99.5) {
      run++;
      runStart ??= x.validStart;
      if (run >= 3) return { stratum: "stress_moderate" as const, reason: "D1+=100% for 3+ wks", peak: runStart };
    } else {
      run = 0;
      runStart = null;
    }
  }
  if (maxD1 < 25 && maxD2 === 0) return { stratum: "control" as const, reason: `maxD1+=${maxD1.toFixed(0)}%`, peak: null };
  return { stratum: "excluded" as const, reason: `ambiguous (maxD1+=${maxD1.toFixed(0)}%, maxD2+=${maxD2.toFixed(0)}%)`, peak: null };
}

// ————— RMA cause-of-loss corroboration (corn, drought share) —————

function rmaDroughtShare(colDir: string): Map<string, { droughtIndem: number; totalIndem: number }> {
  const out = new Map<string, { droughtIndem: number; totalIndem: number }>();
  for (const y of YEARS) {
    const path = `${colDir}/colsom_${y}.txt`;
    if (!fs.existsSync(path)) continue;
    for (const line of fs.readFileSync(path, "latin1").split("\n")) {
      const f = line.split("|");
      if (f.length < 20) continue;
      // COLSOM layout (0-based): 0=commodityYear 2=stateAbbrev 3=countyCode
      // 6=cropName 12=colDesc 28=indemnityAmount (verified: lossRatio f[29] = f[28]/f[21])
      if (f[2]?.trim() !== "IL") continue;
      if (f[6]?.trim().toUpperCase() !== "CORN") continue;
      const key = `${f[3].trim()}-${f[0].trim()}`;
      const indem = Number(f[28]) || 0;
      const cause = (f[12] ?? "").trim().toLowerCase();
      const cur = out.get(key) ?? { droughtIndem: 0, totalIndem: 0 };
      cur.totalIndem += indem;
      if (cause.includes("drought")) cur.droughtIndem += indem;
      out.set(key, cur);
    }
  }
  return out;
}

// ————— CDL rotation-consistent patch sampling —————

async function cdlValue(year: number, lng: number, lat: number): Promise<number | null> {
  const [x, y] = proj4("EPSG:4326", ALBERS, [lng, lat]);
  const url = `https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLValue?year=${year}&x=${x.toFixed(1)}&y=${y.toFixed(1)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      const m = (await res.text()).match(/value:\s*(\d+)/);
      if (m) return Number(m[1]);
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  return null;
}

/** corn (class 1) at 3 points in event year + center-point corn in all baseline years */
async function rotationConsistentCornPatch(
  eventYear: number,
  lng: number,
  lat: number
): Promise<boolean> {
  // CDL only exists through 2024 at time of writing; for 2025 events use
  // 2024 as the event-year check and note it (conservative: continuous-corn
  // fields tend to stay corn).
  const cdlEventYear = Math.min(eventYear, 2024);
  const dLat = 120 / 111_320;
  const dLng = 120 / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (const [cx, cy] of [
    [lng, lat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ] as const) {
    if ((await cdlValue(cdlEventYear, cx, cy)) !== 1) return false;
  }
  for (let k = 1; k <= 3; k++) {
    const y = Math.min(eventYear - k, 2024);
    if ((await cdlValue(y, lng, lat)) !== 1) return false;
  }
  return true;
}

async function main() {
  const colDir = process.argv[2];
  const outPath = process.argv[3] ?? "scripts/ml/events-v2.json";
  const concurrency = Number(process.argv[4] ?? 4);
  if (!colDir) throw new Error("usage: build-event-set.ts <colDir> [out] [concurrency]");

  console.log("RMA cause-of-loss…");
  const rma = rmaDroughtShare(colDir);
  console.log(`  ${rma.size} IL county-year corn rows`);

  console.log("USDM weekly stats (20 counties)…");
  const usdm = new Map<string, UsdmWeek[]>();
  for (const c of COUNTIES) {
    usdm.set(c.fips, await usdmWeeks(`17${c.fips}`));
    process.stdout.write(".");
  }
  console.log();

  type Unit = {
    fips: string; county: string; year: number;
    stratum: string; strataReason: string; eventDate: string | null;
    patchLng: number | null; patchLat: number | null; candidatesTried: number;
    usdmPeakWeek: string | null;
    rmaDroughtIndem: number; rmaTotalIndem: number;
    cdlEventYearCapped: boolean;
  };
  const units: Unit[] = [];
  for (const c of COUNTIES) {
    for (const year of YEARS) {
      const cls = classify(usdm.get(c.fips)!, year);
      const rmaRow = rma.get(`${c.fips}-${year}`) ?? { droughtIndem: 0, totalIndem: 0 };
      units.push({
        fips: c.fips, county: c.name, year,
        stratum: cls.stratum, strataReason: cls.reason,
        eventDate: cls.stratum.startsWith("stress") ? cls.peak : cls.stratum === "control" ? `${year}-07-05` : null,
        patchLng: null, patchLat: null, candidatesTried: 0,
        usdmPeakWeek: cls.peak,
        rmaDroughtIndem: Math.round(rmaRow.droughtIndem), rmaTotalIndem: Math.round(rmaRow.totalIndem),
        cdlEventYearCapped: year > 2024,
      });
    }
  }
  const scored = units.filter((u) => u.stratum !== "excluded");
  console.log(
    `strata: strong=${units.filter((u) => u.stratum === "stress_strong").length} ` +
      `moderate=${units.filter((u) => u.stratum === "stress_moderate").length} ` +
      `control=${units.filter((u) => u.stratum === "control").length} ` +
      `excluded=${units.filter((u) => u.stratum === "excluded").length}`
  );

  console.log(`sampling rotation-consistent patches for ${scored.length} scored units…`);
  let idx = 0;
  async function worker() {
    while (idx < scored.length) {
      const u = scored[idx++];
      const c = COUNTIES.find((x) => x.fips === u.fips)!;
      const rand = rng(`${u.fips}-${u.year}-corn-v2`);
      for (let cand = 0; cand < 30 && u.patchLng == null; cand++) {
        u.candidatesTried = cand + 1;
        const lng = c.lng + (rand() - 0.5) * 0.2;
        const lat = c.lat + (rand() - 0.5) * 0.16;
        if (await rotationConsistentCornPatch(u.year, lng, lat)) {
          u.patchLng = Math.round(lng * 1e5) / 1e5;
          u.patchLat = Math.round(lat * 1e5) / 1e5;
        }
      }
      console.log(
        `${u.county} ${u.year} [${u.stratum}] ${u.patchLng != null ? "patch ok" : "NO PATCH"} (${u.candidatesTried} candidates)`
      );
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  fs.writeFileSync(outPath, JSON.stringify({ design: "design-backtest-v2.md", builtAt: new Date().toISOString(), units }, null, 1));
  const withPatch = scored.filter((u) => u.patchLng != null);
  console.log(`\n${withPatch.length}/${scored.length} scored units have a rotation-consistent patch → ${outPath}`);
}

main();
