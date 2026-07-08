import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOperation } from "@/lib/current-op";
import {
  getClaim,
  getField,
  getFcr,
  getCapturesByField,
  getPolicyRef,
  getLabelsForClaim,
  getLatestAuditFor,
} from "@/lib/data";
import { addEvidence, markFcrReviewed, analyzeClaimSatellite, recordOutcome } from "@/app/actions";
import { FieldShape, Meta, PageHeader, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // satellite analysis fetches real scenes

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
  const labels = await getLabelsForClaim(claim.id);
  const unavailable = await getLatestAuditFor("claim", claim.id, "satellite_analysis_unavailable");
  const unavailableReason = (unavailable?.detail as { reason?: string } | undefined)?.reason;

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

          {!op.isDemo && (
            <form action={analyzeClaimSatellite.bind(null, claim.id)} className="card p-5 no-print border-l-4 border-l-forest mb-5">
              <p className="label mb-1">Satellite analysis — primary evidence path</p>
              <p className="text-[13.5px] text-ink-soft mb-3 max-w-[380px]">
                Runs Sentinel-2 change detection around {claim.eventDate}: the field vs its own
                multi-year baseline vs the surrounding region. Takes a minute — it fetches real
                scenes.
              </p>
              {unavailableReason && !latest && (
                <p className="text-[13.5px] mb-3 text-[var(--amber)]">
                  Last attempt: {unavailableReason}
                </p>
              )}
              <button type="submit" className="pill pill--solid pill--sm">
                Analyze with satellite
              </button>
            </form>
          )}

          <form action={addEvidence.bind(null, claim.id)} className="card p-5 space-y-4 no-print">
            <p className="label">Add photo evidence{op.isDemo ? " & run demo analysis" : ""}</p>
            <input type="file" name="photo" accept="image/*" className="text-[14px]" />
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] text-ink-soft max-w-[300px]">
                {op.isDemo
                  ? "No photo handy? Submit empty to ingest a labeled sample capture and see the pipeline run."
                  : "Photos are hashed and stored content-addressed; geotag enforcement lands with the guided capture flow."}
              </p>
              <button type="submit" className="pill">{op.isDemo ? "Analyze" : "Attach photo"}</button>
            </div>
          </form>

          <div className="card p-5 mt-5 no-print">
            <p className="label mb-1">Actual outcome (ground truth)</p>
            <p className="text-[13px] text-ink-soft mb-3 max-w-[380px]">
              When the real number is known — adjuster settlement, your own assessment, or
              harvested yield — record it. Every label sharpens the models that back the next
              farmer&rsquo;s claim.
            </p>
            {labels.map((l) => (
              <p key={l.id} className="text-[13.5px] mb-1">
                <Tag tone="strong">recorded</Tag>{" "}
                <span className="capitalize">{l.labelType.replaceAll("_", " ")}</span>: {l.value}{" "}
                {l.unit === "pct" ? "%" : l.unit.replaceAll("_", " ")} ({l.source})
              </p>
            ))}
            <form action={recordOutcome.bind(null, claim.id)} className="grid grid-cols-2 gap-3 items-end mt-2">
              <div>
                <label className="label block mb-1">What</label>
                <select name="labelType" defaultValue="adjuster_settlement_pct">
                  <option value="adjuster_settlement_pct">Adjuster settlement (% loss)</option>
                  <option value="farmer_damage_pct">My own damage estimate (%)</option>
                  <option value="harvested_yield_bu_ac">Harvested yield (bu/ac)</option>
                </select>
              </div>
              <div>
                <label className="label block mb-1">Value</label>
                <input name="value" type="number" step="any" min="0" required />
              </div>
              <div>
                <label className="label block mb-1">Source</label>
                <select name="source" defaultValue="adjuster">
                  <option value="adjuster">Adjuster</option>
                  <option value="farmer">Me</option>
                  <option value="scale_ticket">Scale tickets</option>
                </select>
              </div>
              <button type="submit" className="pill pill--sm">Record</button>
            </form>
          </div>
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
              {latest.narrative && (
                <p className="text-[14px] text-ink-soft border-t border-ash pt-4 mb-4">{latest.narrative}</p>
              )}
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
            <FieldShape
              boundary={field.boundary}
              overlay={(latest?.affectedArea as never) ?? null}
              className="w-40"
            />
            {latest?.affectedArea && (
              <p className="label mt-1">Red = affected area from change detection</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
