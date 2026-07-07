import { requireOperation } from "@/lib/current-op";
import { getDeadlines, getSeasonsForOperation } from "@/lib/data";
import { getRule, daysUntil, standingRules } from "@/lib/rules/deadlines";
import { markDeadlineDone } from "@/app/actions";
import { PageHeader, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

export default async function DeadlinesPage() {
  const op = await requireOperation();
  const [all, seasons] = await Promise.all([getDeadlines(op.id), getSeasonsForOperation(op.id)]);
  const upcoming = all.filter((d) => d.status === "upcoming");
  const past = all.filter((d) => d.status !== "upcoming");
  const crops = [...new Set(seasons.map((s) => s.crop))];
  const year = seasons[0]?.year ?? new Date().getFullYear();
  const standing = standingRules(op.state, year, crops.length ? crops : ["corn", "soybeans"]);

  return (
    <>
      <PageHeader
        eyebrow={`RMA + FSA · ${op.state} · ${year} crop year`}
        title="Every deadline that"
        accent="matters"
        lede="Pulled from RMA and FSA rules for your state and crops. Miss one and it costs real money — so they all live here, with what happens if you miss them."
      />

      {/* standing obligations — the 72-hour rule deserves top billing */}
      {standing.map((r) => (
        <div key={r.id} className="card p-5 mb-8 border-l-4 border-l-forest">
          <div className="flex items-center gap-3 flex-wrap">
            <Tag tone="urgent">{r.relative}</Tag>
            <h2 className="text-lg">{r.title}</h2>
          </div>
          <p className="text-[15px] text-ink-soft mt-2 max-w-[720px]">{r.description}</p>
          <p className="label mt-3">{r.consequence}</p>
        </div>
      ))}

      <h2 className="text-xl mb-4">Upcoming</h2>
      <ul className="card divide-y divide-ash mb-10">
        {upcoming.map((d) => {
          const rule = getRule(d.ruleId);
          const days = daysUntil(d.dueDate);
          return (
            <li key={d.id} className="p-5 flex flex-wrap items-start gap-4">
              <div className="w-28 shrink-0">
                <p className="font-mono text-[14px]">{fmt(d.dueDate).split(", ")[1]}</p>
                <Tag tone={days <= 30 ? "urgent" : "upcoming"}>{days} days</Tag>
              </div>
              <div className="flex-1 min-w-[240px]">
                <p className="font-medium">{rule?.title}</p>
                <p className="text-[14px] text-ink-soft mt-1">{rule?.description}</p>
                <p className="label mt-2">
                  If missed: <span className="normal-case">{rule?.consequence}</span>
                </p>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-2">
                <Tag tone="done">{rule?.agency}</Tag>
                <form action={markDeadlineDone.bind(null, d.id)}>
                  <button className="pill pill--sm pill--quiet" type="submit">
                    Mark done
                  </button>
                </form>
              </div>
            </li>
          );
        })}
        {upcoming.length === 0 && (
          <li className="p-5 text-ink-soft text-[15px]">
            {all.length === 0 && op.state !== "IL"
              ? `Detailed ${op.state} deadline rules are coming — Illinois corn & soybeans are covered first. The 72-hour notice-of-loss rule above applies everywhere.`
              : "Nothing left on the calendar this year."}
          </li>
        )}
      </ul>

      {past.length > 0 && (
        <>
          <h2 className="text-xl mb-4">Passed or completed</h2>
          <ul className="card divide-y divide-ash opacity-70">
            {past.map((d) => {
              const rule = getRule(d.ruleId);
              return (
                <li key={d.id} className="p-4 flex items-center gap-4">
                  <p className="font-mono text-[13px] w-28 shrink-0">
                    {fmt(d.dueDate).split(", ")[1]}
                  </p>
                  <p className="flex-1 text-[15px]">{rule?.title}</p>
                  <Tag tone={d.status}>{d.status}</Tag>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="label mt-8 max-w-[720px]">
        Dates come from RMA county actuarial documents and FSA calendars for {op.state} and
        can differ by county — always confirm a filing date with your agent or county office.
      </p>
    </>
  );
}
