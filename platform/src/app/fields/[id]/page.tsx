import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOperation } from "@/lib/current-op";
import {
  getField,
  getSeasonsByField,
  getCapturesByField,
  getFcrsByField,
  getSceneObservations,
  getTriggerEvaluations,
} from "@/lib/data";
import { FieldShape, Meta, PageHeader, Tag } from "@/components/ui";
import { SatellitePanel } from "@/components/satellite-panel";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // satellite scans fetch real scenes

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function FieldDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const op = await requireOperation();
  const field = await getField(id, op.id);
  if (!field) notFound();
  const [seasons, captures, fcrs, observations, triggerEvals] = await Promise.all([
    getSeasonsByField(id),
    getCapturesByField(id),
    getFcrsByField(id),
    getSceneObservations(id),
    getTriggerEvaluations(id),
  ]);

  return (
    <>
      <PageHeader
        eyebrow={`${field.county} County${field.fsaFarmNumber ? ` · FSA farm ${field.fsaFarmNumber}` : ""}${field.fsaTractNumber ? ` / tract ${field.fsaTractNumber}` : ""}${field.fsaFieldNumber ? ` / field ${field.fsaFieldNumber}` : ""}`}
        title={field.name}
        actions={<Link href="/claims/new" className="pill">Document damage</Link>}
      />

      <div className="grid lg:grid-cols-[280px_1fr] gap-8">
        <div>
          <FieldShape boundary={field.boundary} className="w-full card p-4" />
          <div className="card p-5 mt-5 space-y-4">
            <Meta k="Acres" v={String(field.acres)} />
            {seasons.map((s) => (
              <Meta
                key={s.id}
                k={`${s.crop} ${s.year}`}
                v={s.plantingDate ? `Planted ${fmt(s.plantingDate + "T12:00:00")}` : "Not planted"}
                sub={
                  s.reportedAcres != null
                    ? `${s.reportedAcres} acres reported`
                    : `${s.intendedAcres} acres — not yet reported`
                }
              />
            ))}
          </div>
        </div>

        <div className="space-y-8">
          <SatellitePanel
            field={field}
            observations={observations}
            triggerEvals={triggerEvals}
            isDemo={op.isDemo}
          />
          <section>
            <h2 className="text-xl mb-4">Condition records</h2>
            {fcrs.length === 0 ? (
              <p className="text-ink-soft text-[15px]">
                No verified condition records yet. They're created when imagery of this field
                is analyzed — usually as part of documenting damage.
              </p>
            ) : (
              <ul className="card divide-y divide-ash">
                {fcrs.map((r) => (
                  <li key={r.id} className="p-4">
                    <div className="flex items-center gap-3 flex-wrap">
                      <Tag tone={r.conditionClass}>{r.conditionClass}</Tag>
                      {r.damageType && <span className="capitalize font-medium">{r.damageType}</span>}
                      <span className="text-[13px] text-ink-soft">
                        {fmt(r.observedAt)} · {r.crop}
                        {r.growthStage ? ` · ${r.growthStage}` : ""}
                      </span>
                      {r.modelName === "demo-analyzer" && <Tag tone="demo">Sample</Tag>}
                    </div>
                    <p className="text-[14px] text-ink-soft mt-2">
                      Severity {r.severityPct}% · {r.affectedAcres} acres affected · confidence{" "}
                      {Math.round(r.confidence * 100)}% · {r.modelName}@{r.modelVersion}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-xl mb-4">Imagery</h2>
            {captures.length === 0 ? (
              <p className="text-ink-soft text-[15px]">No imagery captured for this field yet.</p>
            ) : (
              <ul className="card divide-y divide-ash">
                {captures.map((c) => (
                  <li key={c.id} className="p-4 flex items-center gap-4">
                    <Tag tone="done">{c.source}</Tag>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-[13px] truncate">{c.fileName}</p>
                      <p className="text-[12px] text-ink-soft">
                        {fmt(c.capturedAt)} · sha256 {c.sha256.slice(0, 12)}…
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
