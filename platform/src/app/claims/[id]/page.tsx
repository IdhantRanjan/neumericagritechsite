import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOperation } from "@/lib/current-op";
import {
  getClaim,
  getField,
  getFcr,
  getCapturesByField,
  getPolicyRef,
} from "@/lib/data";
import { addEvidence, markFcrReviewed } from "@/app/actions";
import { FieldShape, Meta, PageHeader, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export default async function ClaimDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const op = await requireOperation();
  const claim = await getClaim(id, op.id);
  if (!claim) notFound();
  const field = await getField(claim.fieldId, op.id);
  if (!field) notFound();
  const policy = claim.policyRefId ? await getPolicyRef(claim.policyRefId) : undefined;
  const captures = await getCapturesByField(claim.fieldId);
  const fcrs = (await Promise.all(claim.fcrIds.map((f) => getFcr(f)))).filter(Boolean);
  const latest = fcrs.at(-1);

  return (
    <>
      <PageHeader
        eyebrow={`Claim record · created ${fmt(claim.createdAt)}`}
        title={`${claim.damageType[0].toUpperCase() + claim.damageType.slice(1)} on`}
        accent={field.name}
        actions={
          latest ? (
            <Link href={`/claims/${claim.id}/packet`} className="pill pill--solid">
              View evidence packet
            </Link>
          ) : undefined
        }
      />

      <div className="card grid grid-cols-2 lg:grid-cols-4 gap-6 p-6 mb-10">
        <Meta k="Event" v={fmt(claim.eventDate)} sub={`discovered ${fmt(claim.discoveredDate)}`} />
        <Meta k="Field" v={`${field.acres} acres`} sub={`${field.county} County`} />
        <Meta
          k="Status"
          v={<Tag tone={claim.status}>{claim.status.replace("_", " ")}</Tag>}
        />
        <Meta
          k="Policy"
          v={policy ? `${policy.planType} ${policy.coverageLevelPct}%` : "—"}
          sub={policy ? `${policy.aipName}` : "link your policy with your agent"}
        />
      </div>

      {claim.narrative && (
        <div className="card p-5 mb-10 max-w-[820px]">
          <p className="label mb-2">Your account</p>
          <p className="text-[15px] italic">&ldquo;{claim.narrative}&rdquo;</p>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-10">
        <section>
          <h2 className="text-xl mb-4">Evidence</h2>
          <ul className="card divide-y divide-ash mb-5">
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
            {captures.length === 0 && (
              <li className="p-4 text-ink-soft text-[15px]">No imagery yet — add photos below.</li>
            )}
          </ul>

          <form action={addEvidence.bind(null, claim.id)} className="card p-5 space-y-4 no-print">
            <p className="label">Add evidence & run analysis</p>
            <input type="file" name="photo" accept="image/*" className="text-[14px]" />
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] text-ink-soft max-w-[300px]">
                No photo handy? Submit empty to ingest a labeled sample capture and see the
                pipeline run.
              </p>
              <button type="submit" className="pill">Analyze</button>
            </div>
          </form>
        </section>

        <section>
          <h2 className="text-xl mb-4">Verified condition record</h2>
          {!latest ? (
            <p className="text-ink-soft text-[15px]">
              Add imagery and run analysis to produce the field condition record — the core of
              your claim packet.
            </p>
          ) : (
            <div className="card p-5">
              <div className="flex items-center gap-3 flex-wrap mb-4">
                <Tag tone={latest.conditionClass}>{latest.conditionClass}</Tag>
                {latest.modelName === "demo-analyzer" && <Tag tone="demo">Sample analysis</Tag>}
                {latest.reviewedBy ? (
                  <Tag tone="strong">Human reviewed</Tag>
                ) : (
                  <Tag tone="urgent">Awaiting review</Tag>
                )}
              </div>
              <div className="grid grid-cols-2 gap-5 mb-4">
                <Meta k="Severity" v={`${latest.severityPct}%`} />
                <Meta k="Affected" v={`${latest.affectedAcres} ac`} sub={`of ${field.acres}`} />
                <Meta k="Confidence" v={`${Math.round(latest.confidence * 100)}%`} />
                <Meta k="Growth stage" v={latest.growthStage ?? "—"} />
              </div>
              <div className="border-t border-ash pt-4">
                <p className="label mb-2">Metrics</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(latest.metrics).map(([k, v]) => (
                    <span key={k} className="tag tag--ash">{k} = {v}</span>
                  ))}
                </div>
              </div>
              <div className="border-t border-ash pt-4 mt-4">
                <p className="label mb-2">Provenance</p>
                <p className="text-[13px] text-ink-soft font-mono leading-relaxed">
                  {latest.modelName}@{latest.modelVersion} · run {latest.pipelineRunId}
                  <br />
                  {latest.imagerySha256.length} imagery hash
                  {latest.imagerySha256.length === 1 ? "" : "es"} · analyzed {fmt(latest.analyzedAt)}
                </p>
              </div>
              {!latest.reviewedBy && (
                <form action={markFcrReviewed.bind(null, latest.id, claim.id)} className="mt-4 no-print">
                  <button type="submit" className="pill pill--sm">
                    Sign off review → packet ready
                  </button>
                </form>
              )}
            </div>
          )}
          <div className="mt-5">
            <FieldShape boundary={field.boundary} className="w-40" />
          </div>
        </section>
      </div>
    </>
  );
}
