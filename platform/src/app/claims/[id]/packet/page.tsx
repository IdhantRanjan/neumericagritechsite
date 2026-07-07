/**
 * The evidence packet — the deliverable of Pillar 1. Print-ready (browser
 * print → PDF for the scaffold), structured the way an adjuster reads:
 * what happened, where, verified by what, calculated how.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOperation } from "@/lib/current-op";
import {
  getClaim,
  getField,
  getFcr,
  getPolicyRef,
  getCapturesByField,
} from "@/lib/data";
import { FieldShape, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

export default async function PacketPage({ params }: { params: Promise<{ id: string }> }) {
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
  const isDemo = op.isDemo || latest?.modelName === "demo-analyzer";

  return (
    <div className="max-w-[820px] mx-auto">
      <div className="no-print flex items-center justify-between pt-8">
        <Link href={`/claims/${claim.id}`} className="label hover:text-forest">
          ← Back to claim
        </Link>
        <span className="label">Print this page to produce the PDF packet</span>
      </div>

      {isDemo && (
        <div className="border-2 border-dashed border-[var(--amber)] rounded p-3 mt-6 text-center">
          <span className="label !text-[var(--amber)]">
            Sample packet — fictional data, demo analysis. Not for submission.
          </span>
        </div>
      )}

      <header className="pt-10 pb-8 border-b border-ash">
        <p className="font-mono text-forest mb-4">&lt;/Neumeric&gt;</p>
        <h1 className="text-[2.2rem]">Crop damage evidence packet</h1>
        <p className="text-ink-soft mt-2">
          Prepared for {op.name} · {fmt(claim.createdAt)}
        </p>
      </header>

      <section className="py-8 border-b border-ash grid sm:grid-cols-2 gap-x-10 gap-y-4 text-[15px]">
        <div><span className="label block">Insured / operation</span>{op.name}</div>
        <div><span className="label block">Field</span>{field.name} — {field.acres} acres, {field.county} County, {op.state}</div>
        <div><span className="label block">FSA identifiers</span>Farm {field.fsaFarmNumber} · Tract {field.fsaTractNumber} · Field {field.fsaFieldNumber}</div>
        <div>
          <span className="label block">Policy reference</span>
          {policy
            ? `${policy.planType} at ${policy.coverageLevelPct}% — ${policy.aipName}, policy ${policy.policyNumber}`
            : "To be completed with agent"}
        </div>
        <div><span className="label block">Damage event</span><span className="capitalize">{claim.damageType}</span>, {fmt(claim.eventDate)}</div>
        <div><span className="label block">Damage discovered</span>{fmt(claim.discoveredDate)}</div>
      </section>

      {claim.narrative && (
        <section className="py-8 border-b border-ash">
          <h2 className="text-xl mb-3">Producer statement</h2>
          <p className="italic text-[15px]">&ldquo;{claim.narrative}&rdquo;</p>
        </section>
      )}

      {latest && (
        <section className="py-8 border-b border-ash">
          <h2 className="text-xl mb-4">Verified field condition</h2>
          <div className="flex gap-8 items-start">
            <div className="flex-1">
              <table className="w-full text-[15px]">
                <tbody>
                  {[
                    ["Observed", fmt(latest.observedAt)],
                    ["Crop / stage", `${latest.crop}${latest.growthStage ? ` · ${latest.growthStage}` : ""}`],
                    ["Condition", latest.conditionClass],
                    ["Estimated severity", `${latest.severityPct}%`],
                    ["Affected area", `${latest.affectedAcres} of ${field.acres} acres`],
                    ["Confidence", `${Math.round(latest.confidence * 100)}%`],
                    ...Object.entries(latest.metrics).map(
                      ([k, v]) => [k.replaceAll("_", " "), String(v)] as [string, string]
                    ),
                  ].map(([k, v]) => (
                    <tr key={k} className="border-b border-ash last:border-0">
                      <td className="label py-2 pr-4 align-top w-44">{k}</td>
                      <td className="py-2 capitalize">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="w-40 shrink-0">
              <FieldShape boundary={field.boundary} className="w-full" />
              <p className="label text-center mt-2">{field.name}</p>
            </div>
          </div>
        </section>
      )}

      <section className="py-8 border-b border-ash">
        <h2 className="text-xl mb-4">Imagery inventory</h2>
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="text-left">
              <th className="label pb-2">File</th>
              <th className="label pb-2">Source</th>
              <th className="label pb-2">Captured</th>
              <th className="label pb-2">SHA-256 (integrity)</th>
            </tr>
          </thead>
          <tbody>
            {captures.map((c) => (
              <tr key={c.id} className="border-t border-ash">
                <td className="py-2 pr-3 font-mono truncate max-w-[220px]">{c.fileName}</td>
                <td className="py-2 pr-3 capitalize">{c.source}</td>
                <td className="py-2 pr-3">{fmt(c.capturedAt)}</td>
                <td className="py-2 font-mono">{c.sha256.slice(0, 16)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[13px] text-ink-soft mt-3">
          Each file is stored content-addressed by its SHA-256 hash: the imagery behind this
          packet can be re-verified byte-for-byte at any time.
        </p>
      </section>

      {latest && (
        <section className="py-8 border-b border-ash">
          <h2 className="text-xl mb-3">Analysis provenance</h2>
          <p className="text-[15px] leading-relaxed">
            Condition record <span className="font-mono text-[13px]">{latest.id}</span> was
            produced by <strong>{latest.modelName} v{latest.modelVersion}</strong> (pipeline
            run <span className="font-mono text-[13px]">{latest.pipelineRunId}</span>) on{" "}
            {fmt(latest.analyzedAt)}, from {latest.imagerySha256.length} imagery file
            {latest.imagerySha256.length === 1 ? "" : "s"} listed above.{" "}
            {latest.reviewedBy
              ? `The analysis was reviewed and signed off by ${latest.reviewedBy}.`
              : "Human review pending."}
          </p>
          {latest.modelName === "demo-analyzer" && (
            <p className="mt-3"><Tag tone="demo">Demo analyzer — not a real crop assessment</Tag></p>
          )}
        </section>
      )}

      <footer className="py-8">
        <p className="text-[13px] text-ink-soft leading-relaxed">
          This packet documents field conditions with verifiable imagery and analysis
          provenance. It is documentation assistance prepared at the direction of the insured;
          it is not an insurance adjustment, a coverage determination, or legal advice. Provide
          it to your agent or adjuster alongside your notice of loss.
        </p>
      </footer>
    </div>
  );
}
