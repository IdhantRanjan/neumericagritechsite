/**
 * D3 — honest backtest of the change-detection damage engine.
 *
 * Design: take CDL-verified corn patches from the feature extraction
 * (features.jsonl), and run the production detectDamage() on the SAME
 * counties in a known stress season (2023 — the June flash drought across
 * northern/central Illinois, the year's dominant RMA cause of loss) and a
 * near-normal control season (2021). A discriminating engine should flag
 * damage substantially more often in 2023 than 2021.
 *
 * What this measures: sensitivity to a real, documented regional stress
 * event vs a quiet season, at patch level, with the production methodology.
 * What it CANNOT measure (stated in the report): true field-level
 * false-negative/false-positive rates — those need per-field adjuster
 * labels, which is exactly what the ground-truth flywheel collects.
 *
 * Run: npx tsx scripts/ml/backtest-damage.ts [features.jsonl] [out.json] [nPerYear]
 */
process.env.TURSO_DATABASE_URL = "";
process.env.NEUMERIC_DB_FILE = ".data/backtest.db";

import fs from "node:fs";

const EVENT_DATES: Record<number, string> = {
  2023: "2023-06-20", // flash drought peak (D2-D3 USDM across N/C Illinois)
  2021: "2021-06-20", // control: near-normal season, same calendar date
};

async function main() {
  const featPath = process.argv[2] ?? "scripts/ml/features.jsonl";
  const outPath = process.argv[3] ?? "scripts/ml/backtest-report.json";
  const nPerYear = Number(process.argv[4] ?? 8);

  fs.rmSync(".data/backtest.db", { force: true });
  const { getDb, tables: t } = await import("../../src/db");
  const { detectDamage } = await import("../../src/lib/satellite/damage");
  const { approxRectBoundary } = await import("../../src/lib/satellite/geo");
  const db = await getDb();

  // patches per year from the extraction output — one per county, first N
  const rows = fs
    .readFileSync(featPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { fips: string; county: string; year: number; patchLng: number; patchLat: number });
  const byYear: Record<number, typeof rows> = { 2021: [], 2023: [] };
  const seen = new Set<string>();
  for (const r of rows) {
    if (!(r.year in byYear)) continue;
    const key = `${r.year}-${r.fips}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (byYear[r.year].length < nPerYear) byYear[r.year].push(r);
  }

  const now = new Date().toISOString();
  await db
    .insert(t.operations)
    .values({
      id: "op_backtest", name: "Backtest", state: "IL", counties: ["various"],
      entityType: "sole_proprietor", isDemo: false, accessToken: null, contactEmail: null,
      hasBaseAcres: false, storesGrainOnFarm: false, usesCoverCrops: false, usesNoTill: false,
      createdAt: now,
    })
    .onConflictDoNothing();

  const results: Array<Record<string, unknown>> = [];
  for (const year of [2023, 2021]) {
    for (const p of byYear[year]) {
      const fieldId = `fld_bt_${year}_${p.fips}`;
      const boundary = approxRectBoundary(p.patchLng, p.patchLat, 25);
      await db
        .insert(t.fields)
        .values({
          id: fieldId, operationId: "op_backtest", name: `${p.county} ${year}`,
          county: p.county, acres: 25, boundary,
          fsaFarmNumber: null, fsaTractNumber: null, fsaFieldNumber: null,
        })
        .onConflictDoNothing();
      const field = (await db.select().from(t.fields)).find((f) => f.id === fieldId)!;
      const started = Date.now();
      try {
        const a = await detectDamage(db, field, EVENT_DATES[year]);
        results.push({
          year, county: p.county, fips: p.fips,
          ok: a.ok, significant: a.ok ? a.significant : null,
          severityPct: a.ok ? a.severityPct : null,
          confidence: a.ok ? a.confidence : null,
          extent: a.ok ? a.extent : null,
          persistence: a.ok ? a.persistence : null,
          reason: a.ok ? null : a.reason,
          secs: Math.round((Date.now() - started) / 1000),
        });
        console.log(
          `${year} ${p.county}: ${a.ok ? (a.significant ? `DAMAGE sev=${a.severityPct}% conf=${a.confidence}` : "no significant damage") : `n/a (${a.reason})`} [${Math.round((Date.now() - started) / 1000)}s]`
        );
      } catch (e) {
        results.push({ year, county: p.county, fips: p.fips, ok: false, error: String(e) });
        console.error(`${year} ${p.county}: ERROR ${e}`);
      }
    }
  }

  const summarize = (year: number) => {
    const rs = results.filter((r) => r.year === year && r.ok);
    const fired = rs.filter((r) => r.significant);
    return {
      assessed: rs.length,
      flaggedDamage: fired.length,
      fireRate: rs.length ? Math.round((fired.length / rs.length) * 100) / 100 : null,
      meanSeverityWhenFired: fired.length
        ? Math.round(fired.reduce((s, r) => s + (r.severityPct as number), 0) / fired.length)
        : null,
    };
  };

  const report = {
    ranAt: new Date().toISOString(),
    design:
      "Same-county CDL-verified corn patches; production detectDamage(); stress season (2023-06-20, documented IL flash drought) vs control (2021-06-20, near-normal). Patch locations from extract-features.ts (deterministic).",
    stress2023: summarize(2023),
    control2021: summarize(2021),
    limitations: [
      "Patch-level, not farmer-field-level; ~25-acre rectangles, not real boundaries.",
      "No per-field ground-truth labels exist yet — this tests discrimination between a documented stress season and a quiet one, not absolute accuracy.",
      "2023 drought severity varied across IL; some sampled counties were less affected, so <100% fire rate in 2023 is expected and honest.",
      "Corroborating public record: USDA reported drought as the dominant 2023 IL cause of loss (RMA cause-of-loss files) — regional consistency, not field validation.",
    ],
    results,
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log("\nstress 2023:", JSON.stringify(report.stress2023));
  console.log("control 2021:", JSON.stringify(report.control2021));
  console.log(`report → ${outPath}`);
}

main();
