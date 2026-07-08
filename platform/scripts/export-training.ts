/**
 * Export the labeled training set as JSONL:
 *   npx tsx scripts/export-training.ts > training.jsonl
 */
import { getDb } from "../src/db";
import { exportTrainingRows } from "../src/lib/training-export";

async function main() {
  const db = await getDb();
  const rows = await exportTrainingRows(db);
  for (const row of rows) console.log(JSON.stringify(row));
  console.error(`${rows.length} labeled rows exported`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
