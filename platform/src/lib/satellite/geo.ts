/**
 * Geometry utilities: WGS84 ↔ UTM projection, deterministic analysis grids
 * snapped to the Sentinel-2 10 m UTM grid, polygon rasterization (ray
 * casting), and area math. All pure functions — no I/O.
 */
import proj4 from "proj4";
import type { GeoJSONPolygon } from "@/db/schema";

export interface UtmRing {
  epsg: number;
  ring: Array<[number, number]>; // closed, in UTM meters
}

/** The deterministic analysis grid: snapped to absolute 10 m UTM lines. */
export interface Grid {
  epsg: number;
  originX: number; // west edge (min X), multiple of res
  originY: number; // NORTH edge (max Y), multiple of res
  res: number; // meters per pixel
  width: number;
  height: number;
}

export function utmDef(epsg: number): string {
  const zone = epsg % 100;
  const south = Math.floor(epsg / 100) === 327 ? " +south" : "";
  return `+proj=utm +zone=${zone}${south} +datum=WGS84 +units=m +no_defs`;
}

export function ringToUtm(polygon: GeoJSONPolygon, epsg: number): UtmRing {
  const def = utmDef(epsg);
  const ring = polygon.coordinates[0].map(
    (p) => proj4("EPSG:4326", def, [p[0], p[1]]) as [number, number]
  );
  return { epsg, ring };
}

export function utmToLngLat(epsg: number, x: number, y: number): [number, number] {
  return proj4(utmDef(epsg), "EPSG:4326", [x, y]) as [number, number];
}

export function ringBbox(ring: Array<[number, number]>): [number, number, number, number] {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Snap a UTM bbox outward to the absolute S2 pixel grid (multiples of res). */
export function gridForBbox(
  epsg: number,
  bbox: [number, number, number, number],
  res: number,
  padPx = 1
): Grid {
  const x0 = Math.floor(bbox[0] / res) * res - padPx * res;
  const y1 = Math.ceil(bbox[3] / res) * res + padPx * res; // north edge
  const x1 = Math.ceil(bbox[2] / res) * res + padPx * res;
  const y0 = Math.floor(bbox[1] / res) * res - padPx * res;
  return {
    epsg,
    originX: x0,
    originY: y1,
    res,
    width: Math.round((x1 - x0) / res),
    height: Math.round((y1 - y0) / res),
  };
}

export function pointInRing(ring: Array<[number, number]>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Boolean mask (row-major, north to south) of grid cells whose centers fall inside the ring. */
export function rasterizeRing(grid: Grid, ring: Array<[number, number]>): Uint8Array {
  const mask = new Uint8Array(grid.width * grid.height);
  for (let r = 0; r < grid.height; r++) {
    const y = grid.originY - (r + 0.5) * grid.res;
    for (let c = 0; c < grid.width; c++) {
      const x = grid.originX + (c + 0.5) * grid.res;
      if (pointInRing(ring, x, y)) mask[r * grid.width + c] = 1;
    }
  }
  return mask;
}

/** Shoelace area of a UTM ring, in acres. */
export function ringAcres(ring: Array<[number, number]>): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(s / 2) / 4046.8564224;
}

/** Pick the UTM EPSG covering a lng/lat point (northern hemisphere S2 zones). */
export function epsgForLngLat(lng: number, lat: number): number {
  const zone = Math.floor((lng + 180) / 6) + 1;
  return (lat >= 0 ? 32600 : 32700) + zone;
}

/**
 * Merge a boolean mask into row-run rectangles → WGS84 MultiPolygon.
 * Deterministic and bounded: coarsens to 3×3 majority cells first.
 */
export function maskToMultiPolygon(
  grid: Grid,
  mask: Uint8Array,
  maxRects = 400
): { type: "MultiPolygon"; coordinates: number[][][][] } | null {
  const cell = 3; // 30 m cells from 10 m pixels
  const cw = Math.ceil(grid.width / cell);
  const ch = Math.ceil(grid.height / cell);
  const coarse = new Uint8Array(cw * ch);
  for (let r = 0; r < ch; r++) {
    for (let c = 0; c < cw; c++) {
      let on = 0,
        total = 0;
      for (let dr = 0; dr < cell; dr++) {
        for (let dc = 0; dc < cell; dc++) {
          const rr = r * cell + dr,
            cc = c * cell + dc;
          if (rr >= grid.height || cc >= grid.width) continue;
          total++;
          if (mask[rr * grid.width + cc]) on++;
        }
      }
      if (total > 0 && on / total >= 0.5) coarse[r * cw + c] = 1;
    }
  }
  const polys: number[][][][] = [];
  for (let r = 0; r < ch && polys.length < maxRects; r++) {
    let runStart = -1;
    for (let c = 0; c <= cw; c++) {
      const on = c < cw && coarse[r * cw + c] === 1;
      if (on && runStart < 0) runStart = c;
      if (!on && runStart >= 0) {
        const x0 = grid.originX + runStart * cell * grid.res;
        const x1 = grid.originX + c * cell * grid.res;
        const y1 = grid.originY - r * cell * grid.res;
        const y0 = grid.originY - (r + 1) * cell * grid.res;
        polys.push([
          [
            utmToLngLat(grid.epsg, x0, y0),
            utmToLngLat(grid.epsg, x1, y0),
            utmToLngLat(grid.epsg, x1, y1),
            utmToLngLat(grid.epsg, x0, y1),
            utmToLngLat(grid.epsg, x0, y0),
          ].map(([lng, lat]) => [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]),
        ]);
        runStart = -1;
      }
    }
  }
  return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
}

/** Build an approximate rectangular boundary from a center + acres (labeled approximate in the UI). */
export function approxRectBoundary(lng: number, lat: number, acres: number): GeoJSONPolygon {
  const m2 = acres * 4046.8564224;
  const side = Math.sqrt(m2); // square
  const dLat = side / 2 / 110574;
  const dLng = side / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
  return {
    type: "Polygon",
    coordinates: [
      [
        [lng - dLng, lat - dLat],
        [lng + dLng, lat - dLat],
        [lng + dLng, lat + dLat],
        [lng - dLng, lat + dLat],
        [lng - dLng, lat - dLat],
      ],
    ],
  };
}
