/**
 * Backtest v2 — runner. Executes scripts/ml/design-backtest-v2.md EXACTLY.
 *
 * The engine under test is `s2-l2a-cd@1.0.0` UNCHANGED (same PARAMS_HASH as
 * production). Nothing here moves a threshold. The runner reports:
 *  - per-stratum sensitivity (fired/assessable) with 95% Wilson CIs
 *  - specificity on documented-quiet controls
 *  - unassessable rate (cloud/coverage/short-baseline) as a headline metric
 *  - the CONTINUOUS field_z distribution per stratum (the real signal: with
 *    so few rotation-clean stress patches, binary fire counts are low-power;
 *    the z separation is what says whether the engine SEES the stress)
 *  - reliability bins on fired-call confidence (weak-label caveat attached)
 *  - the weather-corroboration lever variant (fire AND precip <60% normal)
 *
 * Run: npx tsx scripts/ml/backtest-v2.ts [events-v2.json] [out.json]
 */
process.env.TURSO_DATABASE_URL = "";
process.env.NEUMERIC_DB_FILE = ".data/backtest2.db";

import fs from "node:fs";

interface Unit {
  fips: string;
  county: string;
  year: number;
  stratum: "stress_strong" | "stress_moderate" | "control" | "excluded";
  strataReason: string;
  eventDate: string;
  patchLng: number | null;
  patchLat: number | null;
  usdmPeakWeek: string | null;
  rmaDroughtIndem: number | null;
}

// 95% Wilson score interval for a binomial proportion
function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.959964;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function quantiles(xs: number[]) {
  if (xs.length === 0) return { n: 0, mean: null, median: null, p25: null, p75: null };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: s.length,
    mean: r3(xs.reduce((a, b) => a + b, 0) / xs.length),
    median: r3(q(0.5)),
    p25: r3(q(0.25)),
    p75: r3(q(0.75)),
  };
}

async function main() {
  const eventsPath = process.argv[2] ?? "scripts/ml/events-v2.json";
  const outPath = process.argv[3] ?? "scripts/ml/backtest-v2-report.json";

  const events = JSON.parse(fs.readFileSync(eventsPath, "utf8")) as { design: unknown; units: Unit[] };
  const units = events.units.filter((u) => u.patchLng != null && u.stratum !== "excluded");

  fs.rmSync(".data/backtest2.db", { force: true });
  const { getDb, tables: t } = await import("../../src/db");
  const { detectDamage } = await import("../../src/lib/satellite/damage");
  const { evaluateWeatherCounterpart } = await import("../../src/lib/parametric");
  const { approxRectBoundary } = await import("../../src/lib/satellite/geo");
  const { PARAMS_HASH, METHODOLOGY_VERSION } = await import("../../src/lib/satellite/methodology");
  const db = await getDb();

  const now = new Date().toISOString();
  await db
    .insert(t.operations)
    .values({
      id: "op_bt2", name: "Backtest v2", state: "IL", counties: ["various"],
      entityType: "sole_proprietor", isDemo: false, accessToken: null, contactEmail: null,
      hasBaseAcres: false, storesGrainOnFarm: false, usesCoverCrops: false, usesNoTill: false,
      createdAt: now,
    })
    .onConflictDoNothing();

  const results: Array<Record<string, unknown>> = [];
  let done = 0;
  for (const u of units) {
    const fieldId = `fld_bt2_${u.year}_${u.fips}`;
    const boundary = approxRectBoundary(u.patchLng!, u.patchLat!, 25);
    await db
      .insert(t.fields)
      .values({
        id: fieldId, operationId: "op_bt2", name: `${u.county} ${u.year}`,
        county: u.county, acres: 25, boundary,
        fsaFarmNumber: null, fsaTractNumber: null, fsaFieldNumber: null,
      })
      .onConflictDoNothing();
    const field = (await db.select().from(t.fields)).find((f) => f.id === fieldId)!;
    const started = Date.now();
    try {
      const a = await detectDamage(db, field, u.eventDate);
      // weather corroboration lever: window = event ±20d
      const evDate = new Date(u.eventDate);
      const from = new Date(evDate.getTime() - 20 * 864e5).toISOString().slice(0, 10);
      const to = new Date(evDate.getTime() + 20 * 864e5).toISOString().slice(0, 10);
      let precipRatio: number | null = null;
      try {
        const w = await evaluateWeatherCounterpart(field, from, to);
        precipRatio = w.ok ? w.ratioToNormal : null;
      } catch { /* weather optional */ }

      const row = {
        fips: u.fips, county: u.county, year: u.year, stratum: u.stratum,
        eventDate: u.eventDate, rmaDroughtIndem: u.rmaDroughtIndem,
        ok: a.ok,
        significant: a.ok ? a.significant : null,
        fieldZ: a.ok ? (a.metrics.field_z_score ?? null) : null,
        severityPct: a.ok ? a.severityPct : null,
        affectedFrac: a.ok ? a.affectedFrac : null,
        confidence: a.ok ? a.confidence : null,
        extent: a.ok ? a.extent : null,
        persistence: a.ok ? a.persistence : null,
        clearFracPost: a.ok ? (a.metrics.clear_frac_post ?? null) : null,
        precipRatio,
        weatherCorroborated: precipRatio != null ? precipRatio < 0.6 : null,
        reason: a.ok ? null : a.reason,
        secs: Math.round((Date.now() - started) / 1000),
      };
      results.push(row);
      console.log(
        `[${++done}/${units.length}] ${u.county} ${u.year} [${u.stratum}] ` +
          (a.ok
            ? `${a.significant ? "FIRE" : "quiet"} z=${row.fieldZ} sev=${row.severityPct}% conf=${row.confidence} precip=${precipRatio}`
            : `unassessable (${a.reason?.slice(0, 40)})`) +
          ` [${row.secs}s]`
      );
    } catch (e) {
      results.push({ fips: u.fips, county: u.county, year: u.year, stratum: u.stratum, ok: false, error: String(e) });
      console.error(`[${++done}/${units.length}] ${u.county} ${u.year}: ERROR ${e}`);
    }
    fs.writeFileSync(outPath + ".partial", JSON.stringify(results, null, 1));
  }

  // ————— summarize per stratum —————
  const strata = ["stress_strong", "stress_moderate", "control"] as const;
  const summary: Record<string, unknown> = {};
  for (const s of strata) {
    const all = results.filter((r) => r.stratum === s);
    const assessable = all.filter((r) => r.ok);
    const fired = assessable.filter((r) => r.significant);
    const [lo, hi] = wilson(fired.length, assessable.length);
    const zVals = assessable.map((r) => r.fieldZ as number).filter((z) => typeof z === "number");
    const leverFired = assessable.filter((r) => r.significant && r.weatherCorroborated);
    summary[s] = {
      units: all.length,
      assessable: assessable.length,
      unassessable: all.length - assessable.length,
      unassessableRate: all.length ? r2((all.length - assessable.length) / all.length) : null,
      fired: fired.length,
      fireRate: assessable.length ? r2(fired.length / assessable.length) : null,
      fireRate95CI: assessable.length ? [r2(lo), r2(hi)] : null,
      fieldZ: quantiles(zVals),
      leverFired: leverFired.length,
      leverFireRate: assessable.length ? r2(leverFired.length / assessable.length) : null,
    };
  }

  // specificity = 1 − control fire rate
  const ctrl = summary["control"] as { fireRate: number | null };
  const specificity = ctrl.fireRate != null ? r2(1 - ctrl.fireRate) : null;

  // reliability bins on fired-call confidence (weak labels: "correct" = stress stratum)
  const firedCalls = results.filter((r) => r.ok && r.significant);
  const bins = [
    [0, 0.5],
    [0.5, 0.7],
    [0.7, 0.85],
    [0.85, 1.01],
  ];
  const reliability = bins.map(([lo, hi]) => {
    const inBin = firedCalls.filter((r) => (r.confidence as number) >= lo && (r.confidence as number) < hi);
    const correct = inBin.filter((r) => String(r.stratum).startsWith("stress"));
    return {
      confBin: `${lo}-${hi >= 1 ? 1 : hi}`,
      n: inBin.length,
      empiricalPrecision: inBin.length ? r2(correct.length / inBin.length) : null,
    };
  });

  // z-separation: is stress meaningfully more negative than control?
  const zStress = results
    .filter((r) => r.ok && String(r.stratum).startsWith("stress"))
    .map((r) => r.fieldZ as number)
    .filter((z) => typeof z === "number");
  const zControl = results
    .filter((r) => r.ok && r.stratum === "control")
    .map((r) => r.fieldZ as number)
    .filter((z) => typeof z === "number");

  const report = {
    ranAt: new Date().toISOString(),
    engine: { methodologyVersion: METHODOLOGY_VERSION, paramsHash: PARAMS_HASH, tunedToTest: false },
    designRef: "scripts/ml/design-backtest-v2.md (pre-registered, unchanged)",
    nUnitsScored: units.length,
    summary,
    specificity,
    zSeparation: {
      stress: quantiles(zStress),
      control: quantiles(zControl),
      note: "field_z is the field's post-event NDVI vs its own rotation-clean multi-year same-DOY baseline, in σ. More negative = more suppressed. This continuous contrast is higher-power than the binary fire count at this sample size.",
    },
    reliability,
    limitations: [
      "County-level USDM/RMA labels are WEAK: they document county drought, not that a specific 25-acre patch lost yield. A stress-county patch that escaped (irrigation/soil/luck) counts against sensitivity — measured sensitivity is a floor.",
      "Rotation-clean CDL sampling yields few stress patches (corn in event year AND all 3 baseline years is rare in IL corn/soy rotation) — stress CIs are wide and stated as such.",
      "Patch-scale ~25-acre rectangles, not real farmer boundaries.",
      "Tests the drought/deficit path only. Localized acute damage (hail/flood pockets) has no authoritative field-level label at any scale — that blindness is the drone tier's mandate, not something this test can score.",
      "Engine thresholds were NOT tuned to these results; PARAMS_HASH matches production.",
    ],
    results,
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 1));
  fs.rmSync(outPath + ".partial", { force: true });
  console.log(`\n=== wrote ${outPath} ===`);
  console.log("stress_strong:", JSON.stringify(summary["stress_strong"]));
  console.log("stress_moderate:", JSON.stringify(summary["stress_moderate"]));
  console.log("control:", JSON.stringify(summary["control"]));
  console.log("specificity:", specificity);
  console.log("z stress:", JSON.stringify(quantiles(zStress)), "z control:", JSON.stringify(quantiles(zControl)));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
