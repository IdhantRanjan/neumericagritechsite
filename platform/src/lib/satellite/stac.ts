/**
 * STAC client for Element84 Earth Search (open Sentinel-2 L2A COGs on AWS,
 * no key required). Returns deterministic, deduplicated scene references:
 * one scene per calendar day (lowest cloud cover wins), sorted by datetime.
 */
import type { GeoJSONPolygon } from "@/db/schema";
import { PARAMS, canonicalJson, sha256 } from "./methodology";

export interface SceneRef {
  id: string;
  datetime: string; // ISO acquisition time
  date: string; // YYYY-MM-DD
  year: number;
  doy: number;
  epsg: number;
  cloudCover: number | null;
  boaOffsetApplied: boolean;
  processingBaseline: string | null;
  assets: {
    red: string;
    nir: string;
    scl: string;
    blue?: string;
    green?: string;
    rededge1?: string;
  };
  /** Deterministic identity hash of this scene reference (id + assets + time). */
  refHash: string;
}

interface StacItem {
  id: string;
  properties: Record<string, unknown>;
  assets: Record<string, { href: string }>;
}

function doyOf(dateIso: string): number {
  const d = new Date(dateIso);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86_400_000);
}

function toRef(item: StacItem): SceneRef | null {
  const p = item.properties;
  const a = item.assets;
  if (!a.red?.href || !a.nir?.href || !a.scl?.href) return null;
  const datetime = String(p.datetime);
  const assets: SceneRef["assets"] = {
    red: a.red.href,
    nir: a.nir.href,
    scl: a.scl.href,
    blue: a.blue?.href,
    green: a.green?.href,
    rededge1: a.rededge1?.href,
  };
  return {
    id: item.id,
    datetime,
    date: datetime.slice(0, 10),
    year: Number(datetime.slice(0, 4)),
    doy: doyOf(datetime),
    epsg: Number(p["proj:epsg"]),
    cloudCover: p["eo:cloud_cover"] != null ? Number(p["eo:cloud_cover"]) : null,
    boaOffsetApplied: p["earthsearch:boa_offset_applied"] === true,
    processingBaseline: p["s2:processing_baseline"] ? String(p["s2:processing_baseline"]) : null,
    assets,
    refHash: sha256(canonicalJson({ id: item.id, datetime, assets })),
  };
}

/**
 * Search scenes intersecting a polygon in [fromIso, toIso], deduped one per
 * day. If scenes span multiple UTM zones, keeps only the dominant zone so
 * every observation shares one aligned pixel grid (documented limitation
 * for fields straddling a zone boundary).
 */
export async function searchScenes(
  polygon: GeoJSONPolygon,
  fromIso: string,
  toIso: string
): Promise<SceneRef[]> {
  const body = {
    collections: [PARAMS.stac.collection],
    intersects: polygon,
    datetime: `${fromIso}T00:00:00Z/${toIso}T23:59:59Z`,
    query: { "eo:cloud_cover": { lt: PARAMS.stac.maxSceneCloudCover } },
    limit: 100,
  };
  const items: StacItem[] = [];
  let url: string | null = `${PARAMS.stac.endpoint}/search`;
  let payload: unknown = body;
  for (let page = 0; page < 5 && url; page++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`STAC search failed: ${res.status} ${await res.text()}`);
    const fc = (await res.json()) as {
      features: StacItem[];
      links?: Array<{ rel: string; href: string; body?: unknown; method?: string }>;
    };
    items.push(...fc.features);
    const next = fc.links?.find((l) => l.rel === "next");
    url = next?.href ?? null;
    payload = next?.body ?? body;
  }

  const refs = items.map(toRef).filter((r): r is SceneRef => r !== null);

  // dominant UTM zone
  const zoneCounts = new Map<number, number>();
  for (const r of refs) zoneCounts.set(r.epsg, (zoneCounts.get(r.epsg) ?? 0) + 1);
  const dominant = [...zoneCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];

  // one per day: lowest cloud, then lexicographic id for determinism
  const byDay = new Map<string, SceneRef>();
  for (const r of refs) {
    if (r.epsg !== dominant) continue;
    const cur = byDay.get(r.date);
    if (
      !cur ||
      (r.cloudCover ?? 101) < (cur.cloudCover ?? 101) ||
      ((r.cloudCover ?? 101) === (cur.cloudCover ?? 101) && r.id < cur.id)
    ) {
      byDay.set(r.date, r);
    }
  }
  return [...byDay.values()].sort((a, b) => (a.datetime < b.datetime ? -1 : 1));
}
