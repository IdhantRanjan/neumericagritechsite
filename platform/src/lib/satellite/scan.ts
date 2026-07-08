/**
 * Field scanning: pull the Sentinel-2 time series for a field's boundary
 * over a date range, compute per-scene observations, and persist them
 * incrementally (scenes already observed under the current methodology are
 * skipped). This is the shared ingestion path for damage detection, yield
 * estimation, and parametric trigger evaluation.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gte, lte } from "drizzle-orm";
import { tables as t, type DB } from "@/db";
import type { Field } from "@/db/schema";
import { METHODOLOGY_VERSION } from "./methodology";
import { searchScenes, type SceneRef } from "./stac";
import { observationStats, readScenePixels } from "./observe";

export interface ScanResult {
  searched: number;
  alreadyStored: number;
  observed: number;
  failed: Array<{ sceneId: string; error: string }>;
}

/** Run one batch of a scan. `maxScenes` bounds serverless run time; call again to continue. */
export async function scanField(
  db: DB,
  field: Field,
  fromIso: string,
  toIso: string,
  opts: { maxScenes?: number; concurrency?: number } = {}
): Promise<ScanResult> {
  if (!field.boundary) throw new Error("Field has no boundary polygon");
  const maxScenes = opts.maxScenes ?? 60;
  const concurrency = opts.concurrency ?? 4;

  const scenes = await searchScenes(field.boundary, fromIso, toIso);
  const existing = await db
    .select({ sceneId: t.sceneObservations.sceneId })
    .from(t.sceneObservations)
    .where(
      and(
        eq(t.sceneObservations.fieldId, field.id),
        eq(t.sceneObservations.methodologyVersion, METHODOLOGY_VERSION)
      )
    );
  const have = new Set(existing.map((e) => e.sceneId));
  const todo = scenes.filter((s) => !have.has(s.id)).slice(0, maxScenes);

  const result: ScanResult = {
    searched: scenes.length,
    alreadyStored: scenes.length - (scenes.length - have.size > 0 ? scenes.length - have.size : 0),
    observed: 0,
    failed: [],
  };
  result.alreadyStored = scenes.filter((s) => have.has(s.id)).length;

  for (let i = 0; i < todo.length; i += concurrency) {
    const batch = todo.slice(i, i + concurrency);
    const outcomes = await Promise.allSettled(
      batch.map(async (scene) => {
        const px = await readScenePixels(field.boundary!, scene, "core");
        return { scene, obs: observationStats(px) };
      })
    );
    for (let j = 0; j < outcomes.length; j++) {
      const o = outcomes[j];
      if (o.status === "rejected") {
        result.failed.push({ sceneId: batch[j].id, error: String(o.reason).slice(0, 200) });
        continue;
      }
      const { scene, obs } = o.value;
      await db
        .insert(t.sceneObservations)
        .values({
          id: `obs_${randomUUID().slice(0, 12)}`,
          fieldId: field.id,
          sceneId: scene.id,
          source: "earth-search/sentinel-2-l2a",
          acquiredAt: scene.datetime,
          year: scene.year,
          doy: scene.doy,
          epsg: scene.epsg,
          cloudCoverScene: scene.cloudCover,
          clearFrac: obs.clearFrac,
          waterFrac: obs.waterFrac,
          validPixels: obs.validPixels,
          totalPixels: obs.totalPixels,
          stats: obs.stats,
          sceneRefHash: scene.refHash,
          methodologyVersion: METHODOLOGY_VERSION,
          createdAt: new Date().toISOString(),
        })
        .onConflictDoNothing();
      result.observed++;
    }
  }
  return result;
}

/** Stored observations for a field in a date range, current methodology, sorted by time. */
export async function getObservations(db: DB, fieldId: string, fromIso?: string, toIso?: string) {
  const conds = [
    eq(t.sceneObservations.fieldId, fieldId),
    eq(t.sceneObservations.methodologyVersion, METHODOLOGY_VERSION),
  ];
  if (fromIso) conds.push(gte(t.sceneObservations.acquiredAt, fromIso));
  if (toIso) conds.push(lte(t.sceneObservations.acquiredAt, toIso + "T23:59:59Z"));
  const rows = await db
    .select()
    .from(t.sceneObservations)
    .where(and(...conds));
  return rows.sort((a, b) => (a.acquiredAt < b.acquiredAt ? -1 : 1));
}

export type SceneRefLite = Pick<SceneRef, "id" | "datetime">;
