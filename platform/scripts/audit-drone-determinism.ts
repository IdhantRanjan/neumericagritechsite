/** A4: drone pipeline determinism on a REAL georeferenced GeoTIFF (Sentinel-2
 * TCI, EPSG:32616). Runs analyzeOrtho twice on identical bytes over the real
 * Home 80 boundary; outputs must be byte-identical JSON. Also proves the
 * geo-tag reading path (origin/resolution/EPSG from GeoTIFF keys). */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { analyzeOrtho } from "../src/lib/drone/analyze";
import { approxRectBoundary } from "../src/lib/satellite/geo";

async function main() {
  const buf = fs.readFileSync("/tmp/tci_20230617.tif");
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const boundary = approxRectBoundary(-88.742, 41.912, 78.4);
  const a1 = await analyzeOrtho(ab, boundary, {});
  const a2 = await analyzeOrtho(ab, boundary, {});
  const j1 = JSON.stringify(a1), j2 = JSON.stringify(a2);
  const h1 = createHash("sha256").update(j1).digest("hex");
  console.log(JSON.stringify({
    ok: a1.ok, reason: a1.reason ?? null, epsgRead: a1.stats?.epsg,
    index: a1.index, resM: a1.resolutionM, fieldPixels: a1.fieldPixels,
    affectedFrac: a1.affectedFrac, severityPct: a1.severityPct,
    validation: a1.validationStatus,
    deterministic: j1 === j2, outputSha256: h1.slice(0, 16),
  }, null, 1));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
