/**
 * Hard Core 1 deliverable check — run the REAL pipeline end to end:
 * real Illinois field boundary (DeKalb County), real Sentinel-2 scenes from
 * the open AWS bucket, real detection of the June 2023 flash drought.
 * No seeded numbers anywhere in the output.
 *
 *   npx tsx scripts/prove-damage.ts [eventDate]
 */
import { eq } from "drizzle-orm";
import { getDb, tables as t } from "../src/db";
import { detectDamage } from "../src/lib/satellite/damage";
import { getObservations } from "../src/lib/satellite/scan";

const eventDate = process.argv[2] ?? "2023-06-20";

async function main() {
  const db = await getDb();
  const field = (await db.select().from(t.fields).where(eq(t.fields.id, "fld_home")))[0];
  if (!field) throw new Error("Home 80 not found — run once to seed");
  console.log(`Field: ${field.name}, ${field.acres} ac, ${field.county} County IL`);
  console.log(`Event date under test: ${eventDate} (2023 IL flash drought)\n`);

  const t0 = Date.now();
  const result = await detectDamage(db, field, eventDate);
  console.log(`\nAssessment completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const obs = await getObservations(db, field.id);
  console.log(`Stored observations for field: ${obs.length}`);
  console.log("\nTime series (clear obs, NDVI mean):");
  for (const o of obs.filter((o) => o.clearFrac >= 0.6)) {
    console.log(
      `  ${o.acquiredAt.slice(0, 10)}  ndvi=${o.stats.ndvi_mean?.toFixed(3) ?? "  n/a"}  clear=${(o.clearFrac * 100).toFixed(0)}%  scene=${o.sceneId}`
    );
  }

  console.log("\n=== DAMAGE ASSESSMENT ===");
  const { affectedArea, ...rest } = result;
  console.log(JSON.stringify(rest, null, 2));
  console.log(`affectedArea: ${affectedArea ? `MultiPolygon, ${affectedArea.coordinates.length} rects` : "null"}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
