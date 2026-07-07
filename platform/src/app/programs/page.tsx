import { requireOperation } from "@/lib/current-op";
import { getProgramMatches } from "@/lib/data";
import { getPrograms } from "@/lib/rules/programs";
import { setProgramStatus } from "@/app/actions";
import { PageHeader, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  const op = await requireOperation();
  const matches = await getProgramMatches(op.id);
  const programs = getPrograms();

  return (
    <>
      <PageHeader
        eyebrow="USDA · FSA · NRCS"
        title="Money you may be"
        accent="leaving"
        lede="Your operation's profile, checked against farm program rules. Every match shows its reasoning — what fits, what's unknown — so you can walk into the FSA office already knowing the answer."
      />

      <div className="space-y-5 max-w-[860px]">
        {matches.map((m) => {
          const p = programs.find((x) => x.id === m.programId);
          if (!p) return null;
          const dimmed = m.status === "dismissed";
          return (
            <div key={m.id} className={`card p-6 ${dimmed ? "opacity-50" : ""}`}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-[1.3rem]">{p.name}</h2>
                    <Tag tone={m.strength}>{m.strength} match</Tag>
                    {m.status !== "new" && <Tag tone="done">{m.status}</Tag>}
                  </div>
                  <p className="label mt-1">{p.agency}</p>
                </div>
                <div className="flex gap-2 no-print">
                  {m.status !== "pursuing" && (
                    <form action={setProgramStatus.bind(null, m.id, "pursuing")}>
                      <button className="pill pill--sm" type="submit">Pursue</button>
                    </form>
                  )}
                  {m.status !== "dismissed" && (
                    <form action={setProgramStatus.bind(null, m.id, "dismissed")}>
                      <button className="pill pill--sm pill--quiet" type="submit">Not for us</button>
                    </form>
                  )}
                </div>
              </div>

              <p className="text-[15px] text-ink-soft mt-3 max-w-[680px]">{p.summary}</p>
              <p className="text-[15px] mt-2">
                <span className="label mr-2">Worth roughly</span>
                {p.estimatedValue}
              </p>

              <div className="grid sm:grid-cols-2 gap-5 mt-5 border-t border-ash pt-5">
                <div>
                  <p className="label mb-2 !text-forest-ink">Why it matched</p>
                  <ul className="space-y-1.5">
                    {m.matchedCriteria.map((c) => (
                      <li key={c} className="text-[14px] flex gap-2">
                        <span className="text-forest">✓</span> {c}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="label mb-2 !text-[var(--amber)]">Still to confirm</p>
                  <ul className="space-y-1.5">
                    {m.missingCriteria.length === 0 ? (
                      <li className="text-[14px] text-ink-soft">Nothing — looks fully eligible.</li>
                    ) : (
                      m.missingCriteria.map((c) => (
                        <li key={c} className="text-[14px] flex gap-2">
                          <span className="text-[var(--amber)]">?</span> {c}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>

              <p className="label mt-4">
                Bring: <span className="normal-case">{p.evidence.join(" · ")}</span>
              </p>
            </div>
          );
        })}
      </div>

      <p className="label mt-8 max-w-[720px]">
        Estimates are ballparks from program rules, not promises — final eligibility and
        payment amounts are determined by FSA/NRCS. Signup windows change; your county office
        has the current dates.
      </p>
    </>
  );
}
