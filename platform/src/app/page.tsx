import Link from "next/link";
import { requireOperation } from "@/lib/current-op";
import {
  getFields,
  getSeasonsForOperation,
  getDeadlines,
  getClaims,
  getProgramMatches,
  getMarketingPositions,
  getPlanTargets,
} from "@/lib/data";
import { getRule, daysUntil } from "@/lib/rules/deadlines";
import { getPrograms } from "@/lib/rules/programs";
import { derivePosition, targetHit } from "@/lib/marketing";
import { Meta, PageHeader, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export default async function Dashboard() {
  const op = await requireOperation();
  const [fields, seasons, allDeadlines, claims, allMatches, positions] = await Promise.all([
    getFields(op.id),
    getSeasonsForOperation(op.id),
    getDeadlines(op.id),
    getClaims(op.id),
    getProgramMatches(op.id),
    getMarketingPositions(op.id),
  ]);
  const deadlines = allDeadlines.filter((d) => d.status === "upcoming");
  const matches = allMatches.filter((m) => m.status !== "dismissed");
  const programs = getPrograms();

  const totalAcres = fields.reduce((a, f) => a + f.acres, 0);
  const next = deadlines[0];
  const nextRule = next ? getRule(next.ruleId) : undefined;
  const openClaims = claims.filter((c) => c.status !== "closed");
  const unreported = seasons.filter((s) => s.reportedAcres == null);
  const position = positions[0];
  const derived = position ? derivePosition(position) : null;
  const targets = position ? await getPlanTargets(position.id) : [];
  const hitTargets = position
    ? targets.filter((t) => t.status === "waiting" && targetHit(t.kind, t.targetValue, position))
    : [];

  return (
    <>
      <PageHeader
        eyebrow={`${op.name} · ${op.counties.join(" & ")} Co., ${op.state}`}
        title="What needs your"
        accent="attention"
        lede="Deadlines, claims, program money, and your marketing position in one place — backed by verified records of what's actually happening in your fields."
      />

      {hitTargets.length > 0 && (
        <Link href="/marketing" className="card p-4 mb-8 flex items-center gap-4 border-l-4 border-l-[var(--amber)] hover:border-forest transition-colors">
          <Tag tone="urgent">Plan target hit</Tag>
          <p className="text-[15px]">
            {hitTargets.length === 1
              ? "One of your marketing plan targets has been reached — the numbers crossed the line you set."
              : `${hitTargets.length} of your marketing plan targets have been reached.`}{" "}
            <span className="text-forest">Review your plan →</span>
          </p>
        </Link>
      )}

      <section className="card grid grid-cols-2 lg:grid-cols-4 gap-6 p-6 mb-10">
        <Meta k="Land" v={`${fields.length} fields`} sub={`${Math.round(totalAcres)} acres`} />
        <Meta
          k="Next deadline"
          v={next ? fmt(next.dueDate) : "None"}
          sub={next && nextRule ? `${nextRule.title} · ${daysUntil(next.dueDate)} days` : undefined}
        />
        <Meta
          k="Open claims"
          v={String(openClaims.length)}
          sub={`${openClaims.filter((c) => c.fcrIds.length > 0).length} with verified evidence`}
        />
        <Meta
          k={position && derived ? `${position.crop} priced` : "Marketing"}
          v={position && derived ? `${derived.pctPriced}%` : "—"}
          sub={
            position && derived
              ? `breakeven ${derived.breakevenPerBu ? `$${derived.breakevenPerBu.toFixed(2)}` : "—"}`
              : "enter your position"
          }
        />
      </section>

      <div className="grid lg:grid-cols-2 gap-10">
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-xl">Coming up</h2>
            <Link href="/deadlines" className="label hover:text-forest">
              All deadlines →
            </Link>
          </div>
          <ul className="card divide-y divide-ash">
            {deadlines.slice(0, 4).map((d) => {
              const rule = getRule(d.ruleId);
              const days = daysUntil(d.dueDate);
              return (
                <li key={d.id} className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[15px]">{rule?.title}</p>
                    <p className="text-[13px] text-ink-soft">
                      {rule?.agency} · {d.crop}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-[13px]">{fmt(d.dueDate)}</p>
                    <Tag tone={days <= 30 ? "urgent" : "upcoming"}>{days} days</Tag>
                  </div>
                </li>
              );
            })}
            {deadlines.length === 0 && (
              <li className="p-4 text-[14px] text-ink-soft">
                No tracked deadlines yet
                {op.state !== "IL" ? ` — detailed ${op.state} rules are coming; Illinois is covered first` : ""}.
              </li>
            )}
          </ul>
          {unreported.length > 0 && (
            <p className="mt-3 text-[14px] text-ink-soft">
              <span className="tag tag--amber mr-2">Heads up</span>
              {unreported.length} crop{unreported.length > 1 ? "s" : ""} still unreported for
              the acreage report.
            </p>
          )}
        </section>

        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-xl">Claims & evidence</h2>
            <Link href="/claims" className="label hover:text-forest">
              All claims →
            </Link>
          </div>
          <ul className="card divide-y divide-ash">
            {openClaims.map((c) => {
              const field = fields.find((f) => f.id === c.fieldId);
              return (
                <li key={c.id}>
                  <Link
                    href={`/claims/${c.id}`}
                    className="p-4 flex items-center gap-4 hover:bg-[var(--forest-tint)] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[15px] capitalize">
                        {c.damageType} — {field?.name}
                      </p>
                      <p className="text-[13px] text-ink-soft">
                        Event {fmt(c.eventDate)} · {c.fcrIds.length} verified record
                        {c.fcrIds.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Tag tone={c.status}>{c.status.replace("_", " ")}</Tag>
                  </Link>
                </li>
              );
            })}
            <li className="p-4">
              <Link href="/claims/new" className="pill pill--sm">
                + Document new damage
              </Link>
            </li>
          </ul>

          <div className="mt-8">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-xl">Money worth a look</h2>
              <Link href="/programs" className="label hover:text-forest">
                All programs →
              </Link>
            </div>
            <ul className="card divide-y divide-ash">
              {matches.slice(0, 3).map((m) => {
                const p = programs.find((x) => x.id === m.programId);
                return (
                  <li key={m.id} className="p-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[15px]">{p?.name}</p>
                      <p className="text-[13px] text-ink-soft truncate">{p?.estimatedValue}</p>
                    </div>
                    <Tag tone={m.strength}>{m.strength}</Tag>
                  </li>
                );
              })}
              {matches.length === 0 && (
                <li className="p-4 text-[14px] text-ink-soft">
                  No matches yet — update your farm profile in{" "}
                  <Link href="/settings" className="text-forest">Farm settings</Link>.
                </li>
              )}
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}
