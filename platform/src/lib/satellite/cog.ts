/**
 * Windowed Cloud-Optimized GeoTIFF reads against the open Sentinel-2 bucket.
 * Reads only the bytes covering the analysis grid (a field is a few hundred
 * KB per band, not the 700 MB tile). All resampling is deterministic
 * (nearest neighbor by coordinate math).
 */
import { fromUrl } from "geotiff";
import type { Grid } from "./geo";
import type { SceneRef } from "./stac";

const REFLECTANCE_SCALE = 0.0001;
const BOA_OFFSET = -0.1; // applied only when the item says it wasn't baked in

/**
 * Read a reflectance band resampled onto the analysis grid.
 * Returns Float32Array (row-major, north→south); NaN = nodata.
 */
export async function readBandOnGrid(
  href: string,
  grid: Grid,
  scene: Pick<SceneRef, "boaOffsetApplied" | "processingBaseline">
): Promise<Float32Array> {
  const raw = await readRawOnGrid(href, grid);
  const out = new Float32Array(raw.length);
  const needsOffset =
    !scene.boaOffsetApplied &&
    scene.processingBaseline !== null &&
    parseFloat(scene.processingBaseline) >= 4;
  const offset = needsOffset ? BOA_OFFSET : 0;
  for (let i = 0; i < raw.length; i++) {
    const dn = raw[i];
    out[i] = dn === 0 ? NaN : Math.max(0, dn * REFLECTANCE_SCALE + offset);
  }
  return out;
}

/** Read the SCL classification band (20 m) resampled onto the (10 m) grid. */
export async function readSclOnGrid(href: string, grid: Grid): Promise<Uint8Array> {
  const raw = await readRawOnGrid(href, grid);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i];
  return out;
}

/**
 * Core read: nearest-neighbor sample the source raster (any native
 * resolution) at each grid-cell center. Fetches one covering window.
 */
async function readRawOnGrid(href: string, grid: Grid): Promise<Float64Array> {
  const tiff = await fromUrl(href);
  const img = await tiff.getImage();
  const [ox, oy] = img.getOrigin();
  const [rx, ryRaw] = img.getResolution();
  const ry = ryRaw; // negative (north-up)
  const iw = img.getWidth();
  const ih = img.getHeight();

  const gx0 = grid.originX;
  const gy1 = grid.originY; // north edge
  const gx1 = grid.originX + grid.width * grid.res;
  const gy0 = grid.originY - grid.height * grid.res;

  // covering source-pixel window, clamped to the image
  let px0 = Math.floor((gx0 - ox) / rx);
  let px1 = Math.ceil((gx1 - ox) / rx);
  let py0 = Math.floor((gy1 - oy) / ry); // ry negative → smaller row = more north
  let py1 = Math.ceil((gy0 - oy) / ry);
  px0 = Math.max(0, Math.min(px0, iw - 1));
  py0 = Math.max(0, Math.min(py0, ih - 1));
  px1 = Math.max(px0 + 1, Math.min(px1, iw));
  py1 = Math.max(py0 + 1, Math.min(py1, ih));

  const rasters = await img.readRasters({ window: [px0, py0, px1, py1] });
  const band = rasters[0] as ArrayLike<number>;
  const ww = px1 - px0;

  const out = new Float64Array(grid.width * grid.height);
  for (let r = 0; r < grid.height; r++) {
    const y = gy1 - (r + 0.5) * grid.res;
    const srow = Math.floor((y - oy) / ry) - py0;
    for (let c = 0; c < grid.width; c++) {
      const x = gx0 + (c + 0.5) * grid.res;
      const scol = Math.floor((x - ox) / rx) - px0;
      out[r * grid.width + c] =
        srow < 0 || scol < 0 || srow >= py1 - py0 || scol >= ww ? 0 : band[srow * ww + scol];
    }
  }
  return out;
}
