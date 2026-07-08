/**
 * Field satellite panel: boundary setup, scan control, NDVI time series,
 * and the parametric trigger preview with the weather-index basis-risk
 * comparison. Server component — all interactions are server actions.
 */
import type { Field } from "@/db/schema";
import type { tables } from "@/db";
import { setFieldBoundary, evaluateTriggerAction } from "@/app/actions";
import { Tag } from "@/components/ui";
import { ScanButton } from "@/components/scan-button";

type Observation = typeof tables.sceneObservations.$inferSelect;
type TriggerEval = typeof tables.triggerEvaluations.$inferSelect;

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function Sparkline({ obs }: { obs: Observation[] }) {
  const pts = obs.filter((o) => o.clearFrac >= 0.6 && typeof o.stats.ndvi_mean === "number");
  if (pts.length < 3) return null;
  const t0 = new Date(pts[0].acquiredAt).getTime();
  const t1 = new Date(pts[pts.length - 1].acquiredAt).getTime();
  const W = 560,
    H = 90,
    P = 6;
  const x = (o: Observation) => P + ((new Date(o.acquiredAt).getTime() - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
  const y = (v: number) => H - P - Math.max(0, Math.min(1, v)) * (H - 2 * P);
  const path = pts.map((o, i) => `${i === 0 ? "M" : "L"}${x(o).toFixed(1)},${y(o.stats.ndvi_mean).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[560px] mt-2" aria-label="NDVI time series">
      {[0.2, 0.4, 0.6, 0.8].map((g) => (
        <line key={g} x1={P} x2={W - P} y1={y(g)} y2={y(g)} stroke="var(--ash)" strokeWidth="1" />
      ))}
      <path d={path} fill="none" stroke="var(--forest)" strokeWidth="1.75" />
      {pts.map((o) => (
        <circle key={o.id} cx={x(o)} cy={y(o.stats.ndvi_mean)} r="2" fill="var(--forest-deep)" />
      ))}
      <text x={P} y={y(0.8) - 3} className="fill-[var(--ink-soft)]" fontSize="9" fontFamily="monospace">
        NDVI 0.8
      </text>
    </svg>
  );
}

export function SatellitePanel({
  field,
  observations,
  triggerEvals,
  isDemo,
}: {
  field: Field;
  observations: Observation[];
  triggerEvals: TriggerEval[];
  isDemo: boolean;
}) {
  const clear = observations.filter((o) => o.clearFrac >= 0.6);
  const latest = clear.at(-1);
  const years = [...new Set(observations.map((o) => o.year))].sort();
  const thisYear = new Date().getFullYear();

  if (!field.boundary) {
    return (
      <section className="card p-5">
        <p className="label mb-2">Satellite analysis — needs a boundary</p>
        <p className="text-[14px] text-ink-soft mb-4 max-w-[560px]">
          Paste the field&rsquo;s boundary as GeoJSON (export it from FSA farm maps, Google
          Earth, or any GIS tool), or give a center point to start with an approximate
          rectangle sized to your stated acres.
        </p>
        <form action={setFieldBoundary.bind(null, field.id)} className="space-y-3 max-w-[560px]">
          <textarea
            name="geojson"
            rows={3}
            placeholder='{"type":"Polygon","coordinates":[[[lng,lat],...]]}'
            className="font-mono !text-[12px]"
          />
          <div className="grid grid-cols-3 gap-3 items-end">
            <div>
              <label className="label block mb-1">…or center lat</label>
              <input name="lat" type="number" step="any" placeholder="41.912" />
            </div>
            <div>
              <label className="label block mb-1">center lng</label>
              <input name="lng" type="number" step="any" placeholder="-88.742" />
            </div>
            <button type="submit" className="pill pill--sm">Set boundary</button>
          </div>
          <p className="label">Approximate rectangles are fine for scans — replace with the real boundary before using results as claim evidence.</p>
        </form>
      </section>
    );
  }

  const latestEval = triggerEvals[0];
  const evalTrace = latestEval?.calculationTrace as
    | {
        weatherCounterpart?: { ratioToNormal?: number | null; windowPrecipMm?: number | null; normalPrecipMm?: number | null; weatherFired?: boolean | null };
        basisRiskGap?: { gap: string; story: string };
        window?: { from: string; to: string };
        methodologyHash?: string;
      }
    | undefined;

  return (
    <section className="space-y-6">
      <div className="card p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="label mb-1">Sentinel-2 observations · methodology s2-l2a-cd@1.0.0</p>
            <p className="text-[14px] text-ink-soft">
              {observations.length} scenes observed ({clear.length} clear) across {years.length}{" "}
              season{years.length === 1 ? "" : "s"}
              {latest
                ? ` · latest ${fmt(latest.acquiredAt)}: NDVI ${latest.stats.ndvi_mean?.toFixed(2)}`
                : ""}
            </p>
          </div>
          <ScanButton
            fieldId={field.id}
            label={observations.length === 0 ? "Scan this field" : "Scan more scenes"}
          />
        </div>
        <Sparkline obs={observations} />
        {observations.length === 0 && (
          <p className="text-[13px] text-ink-soft mt-2">
            Each click ingests up to ~20 real scenes (current season first, then prior years for
            baselines). Free Sentinel-2 archive; 10 m pixels; every observation stores its scene
            id, cloud fraction, and reference hash.
          </p>
        )}
      </div>

      {!isDemo && (
        <div className="card p-5">
          <p className="label mb-1">Parametric trigger preview</p>
          <p className="text-[13.5px] text-ink-soft mb-3 max-w-[640px]">
            Evaluates a locked drought-stress methodology (NDVI mean below threshold on 2
            consecutive clear passes) over a window, next to what a weather-index product would
            have seen — the gap between them is the basis risk Neumeric closes.{" "}
            <strong>Preview only:</strong> live triggers require a licensed carrier partner.
          </p>
          <form action={evaluateTriggerAction.bind(null, field.id)} className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end max-w-[640px]">
            <div>
              <label className="label block mb-1">From</label>
              <input name="from" type="date" required defaultValue={`${thisYear - 3}-06-01`} />
            </div>
            <div>
              <label className="label block mb-1">To</label>
              <input name="to" type="date" required defaultValue={`${thisYear - 3}-07-31`} />
            </div>
            <div>
              <label className="label block mb-1">NDVI threshold</label>
              <input name="threshold" type="number" step="0.01" min="0.05" max="0.95" defaultValue="0.35" />
            </div>
            <button type="submit" className="pill pill--sm">Evaluate</button>
          </form>

          {latestEval && (
            <div className="mt-4 border-t border-ash pt-4">
              <div className="flex items-center gap-3 flex-wrap">
                <Tag tone={latestEval.fired ? "damaged" : "healthy"}>
                  CV trigger: {latestEval.fired ? "FIRED" : "did not fire"}
                </Tag>
                {evalTrace?.weatherCounterpart && (
                  <Tag tone={evalTrace.weatherCounterpart.weatherFired ? "damaged" : "healthy"}>
                    Weather index: {evalTrace.weatherCounterpart.weatherFired == null ? "n/a" : evalTrace.weatherCounterpart.weatherFired ? "FIRED" : "did not fire"}
                  </Tag>
                )}
                <span className="text-[12px] text-ink-soft font-mono">
                  {evalTrace?.window ? `${evalTrace.window.from} → ${evalTrace.window.to}` : ""} · eval {latestEval.id}
                </span>
              </div>
              {evalTrace?.weatherCounterpart?.ratioToNormal != null && (
                <p className="text-[13.5px] text-ink-soft mt-2">
                  Window rainfall {evalTrace.weatherCounterpart.windowPrecipMm} mm vs 10-year
                  normal {evalTrace.weatherCounterpart.normalPrecipMm} mm (
                  {Math.round((evalTrace.weatherCounterpart.ratioToNormal ?? 0) * 100)}% of normal).
                </p>
              )}
              {evalTrace?.basisRiskGap && (
                <p className="text-[14px] mt-2 max-w-[640px]">{evalTrace.basisRiskGap.story}</p>
              )}
              <p className="label mt-3 break-all">
                Methodology hash {evalTrace?.methodologyHash?.slice(0, 24)}… · full observation
                trace stored append-only with the evaluation
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
