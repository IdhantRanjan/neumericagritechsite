/**
 * USDA Cropland Data Layer (CDL) integration — crop-type verification.
 *
 * Source: the public CropScape service (nassgeodata.gmu.edu, no key), which
 * clips the national 30 m CDL raster to a bbox and serves a small GeoTIFF.
 * CRS is EPSG:5070 (CONUS Albers).
 *
 * Used two ways:
 *  - In-app: `cdlComposition(boundary, year)` — what the USDA's own layer
 *    says was planted inside a field boundary that season. Recorded as
 *    additive evidence on satellite FCRs ("boundary was 94% corn in 2023")
 *    and shown on the field page. It does NOT alter index statistics —
 *    changing the masking would change results under the same methodology
 *    version, which the provenance discipline forbids. Per-pixel CDL
 *    masking is specced as methodology v1.1 (docs/ENGINES.md).
 *  - Training: extract-features.ts verifies patch crop type per year.
 */
import proj4 from "proj4";
import { fromArrayBuffer } from "geotiff";
import type { GeoJSONPolygon } from "@/db/schema";
import { fetchWithRetry } from "@/lib/net";
import { log } from "@/lib/log";

const ALBERS =
  "+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs";

/** CDL class → crop name for the classes farmers here actually grow. */
export const CDL_CLASSES: Record<number, string> = {
  1: "corn",
  5: "soybeans",
  22: "durum wheat",
  23: "spring wheat",
  24: "winter wheat",
  26: "winter wheat/soybeans",
  28: "oats",
  36: "alfalfa",
  37: "other hay",
  61: "fallow/idle",
  111: "open water",
  121: "developed (open)",
  122: "developed (low)",
  123: "developed (medium)",
  124: "developed (high)",
  131: "barren",
  141: "deciduous forest",
  176: "grass/pasture",
  190: "woody wetlands",
  195: "herbaceous wetlands",
};

export interface CdlComposition {
  year: number;
  totalPixels: number;
  /** crop name → fraction of boundary pixels (top classes only) */
  fractions: Record<string, number>;
  dominant: string;
  dominantFraction: number;
  source: string;
}

/**
 * Fetch the CDL clip covering a boundary and tabulate class composition
 * over the pixels inside the polygon. Returns null when CropScape is
 * unavailable — callers treat CDL as optional evidence, never a blocker.
 */
export async function cdlComposition(
  boundary: GeoJSONPolygon,
  year: number
): Promise<CdlComposition | null> {
  try {
    const ring = boundary.coordinates[0];
    const albersRing = ring.map((p) => proj4("EPSG:4326", ALBERS, [p[0], p[1]]) as [number, number]);
    const xs = albersRing.map((p) => p[0]);
    const ys = albersRing.map((p) => p[1]);
    const pad = 60; // 2 CDL pixels
    const bbox = [
      Math.floor(Math.min(...xs) - pad),
      Math.floor(Math.min(...ys) - pad),
      Math.ceil(Math.max(...xs) + pad),
      Math.ceil(Math.max(...ys) + pad),
    ].join(",");

    const svc = `https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLFile?year=${year}&bbox=${bbox}`;
    const xml = await (await fetchWithRetry(svc, { timeoutMs: 60_000 })).text();
    const m = xml.match(/<returnURL>([^<]+)<\/returnURL>/);
    if (!m) {
      log.warn("cdl.no_url", { year, xml: xml.slice(0, 200) });
      return null;
    }
    const buf = await (await fetchWithRetry(m[1], { timeoutMs: 60_000 })).arrayBuffer();
    const tiff = await fromArrayBuffer(buf);
    const img = await tiff.getImage();
    const [ox, oy] = img.getOrigin();
    const [rx, ry] = img.getResolution();
    const w = img.getWidth();
    const h = img.getHeight();
    const data = (await img.readRasters({ interleave: true })) as unknown as ArrayLike<number>;

    // point-in-polygon per CDL cell center (Albers space)
    const counts = new Map<number, number>();
    let total = 0;
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const x = ox + (col + 0.5) * rx;
        const y = oy + (row + 0.5) * ry;
        if (!pointInRing(albersRing, x, y)) continue;
        const v = data[row * w + col];
        if (v === 0) continue;
        counts.set(v, (counts.get(v) ?? 0) + 1);
        total++;
      }
    }
    if (total < 4) return null;

    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const fractions: Record<string, number> = {};
    for (const [cls, n] of entries.slice(0, 5)) {
      const name = CDL_CLASSES[cls] ?? `class ${cls}`;
      fractions[name] = Math.round((n / total) * 1000) / 1000;
    }
    const [topCls, topN] = entries[0];
    return {
      year,
      totalPixels: total,
      fractions,
      dominant: CDL_CLASSES[topCls] ?? `class ${topCls}`,
      dominantFraction: Math.round((topN / total) * 1000) / 1000,
      source: `USDA NASS Cropland Data Layer ${year} via CropScape (30 m)`,
    };
  } catch (e) {
    log.warn("cdl.failed", { year, error: String(e) });
    return null;
  }
}

function pointInRing(ring: Array<[number, number]>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
