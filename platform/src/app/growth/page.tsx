/**
 * Founder growth dashboard — the real Illinois validation pipeline and the
 * waitlist funnel, answering the strategic question honestly measured:
 * which channel (direct / lender / agent) actually converts.
 * Access: founder emails only (404 otherwise).
 */
import { notFound } from "next/navigation";
import { desc } from "drizzle-orm";
import { getDb, tables as t } from "@/db";
import { resolveSession } from "@/lib/auth";
import { Meta, PageHeader, Tag } from "@/components/ui";
import { addContact, setContactStage } from "./actions";

export const dynamic = "force-dynamic";

const STAGES = ["identified", "contacted", "replied", "meeting", "piloting", "passed"] as const;
const CHANNELS = ["direct", "lender", "agent", "coop", "other"] as const;

export default async function GrowthPage() {
  const sess = await resolveSession();
  const allowed = (process.env.FOUNDER_EMAILS ?? "idhantran@gmail.com")
    .split(",")
    .map((e) => e.trim().toLowerCase());
  if (!sess || !allowed.includes(sess.user.email)) notFound();

  const db = await getDb();
  const [contacts, waitlist] = await Promise.all([
    db.select().from(t.crmContacts).orderBy(desc(t.crmContacts.updatedAt)),
    db.select().from(t.waitlistSignups).orderBy(desc(t.waitlistSignups.createdAt)),
  ]);

  const funnel = (channel: string) => {
    const rows = waitlist.filter((w) => w.channel === channel);
    return {
      signed: rows.length,
      confirmed: rows.filter((w) => w.status === "confirmed" || w.status === "onboarded").length,
      onboarded: rows.filter((w) => w.status === "onboarded").length,
    };
  };

  return (
    <>
      <PageHeader
        eyebrow="Founder tools · not visible to farmers"
        title="Validation"
        accent="pipeline"
        lede="The real outreach pipeline and the waitlist funnel by channel. Honest counts only — this page reads straight from the database."
      />

      <section className="mb-10">
        <p className="label mb-3">Waitlist funnel by channel (signed → confirmed → onboarded)</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {CHANNELS.map((ch) => {
            const f = funnel(ch);
            return (
              <div key={ch} className="card p-4">
                <Meta k={ch} v={`${f.signed} / ${f.confirmed} / ${f.onboarded}`} sub={f.signed ? `${Math.round((f.onboarded / f.signed) * 100)}% to farm` : "no signups yet"} />
              </div>
            );
          })}
        </div>
        <p className="text-[13px] text-ink-soft mt-2">
          {waitlist.length === 0
            ? "No waitlist signups yet — the marketing-site form writes here once real ones land."
            : `${waitlist.length} total signups.`}
        </p>
      </section>

      <section className="mb-10">
        <p className="label mb-3">Outreach pipeline ({contacts.length})</p>
        {STAGES.map((stage) => {
          const rows = contacts.filter((c) => c.stage === stage);
          if (rows.length === 0) return null;
          return (
            <div key={stage} className="mb-5">
              <p className="label !text-forest-ink mb-2">
                {stage} · {rows.length}
              </p>
              <div className="space-y-2">
                {rows.map((c) => (
                  <div key={c.id} className="card p-4 flex flex-wrap items-center gap-3 justify-between">
                    <div>
                      <p className="text-[15px]">
                        {c.name}
                        {c.org ? <span className="text-ink-soft"> · {c.org}</span> : null}
                        {c.county ? <span className="text-ink-soft"> · {c.county} Co.</span> : null}
                      </p>
                      <p className="text-[13px] text-ink-soft">
                        <Tag tone="ash">{c.kind}</Tag>
                        {c.source ? ` via ${c.source}` : ""}
                        {c.nextAction ? ` — next: ${c.nextAction}${c.nextActionDate ? ` by ${c.nextActionDate}` : ""}` : " — no next action set"}
                      </p>
                      {c.notes && <p className="text-[13px] text-ink-soft mt-1 max-w-[560px]">{c.notes}</p>}
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {STAGES.filter((s) => s !== stage).map((s) => (
                        <form key={s} action={setContactStage.bind(null, c.id, s)}>
                          <button className="label !text-[10px] px-2 py-1 rounded-[60px] border border-ash hover:bg-[var(--forest-tint)]">
                            → {s}
                          </button>
                        </form>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section className="card p-6 max-w-[720px]">
        <p className="label mb-3">Add a contact</p>
        <form action={addContact} className="grid grid-cols-2 gap-3">
          <input name="name" placeholder="Name (required)" required />
          <input name="org" placeholder="Organization / farm" />
          <input name="county" placeholder="County" />
          <select name="kind" defaultValue="farmer">
            <option value="farmer">Farmer</option>
            <option value="lender">Lender</option>
            <option value="agent">Insurance agent</option>
            <option value="extension">Extension / Farm Bureau</option>
            <option value="coop">Co-op / elevator</option>
            <option value="other">Other</option>
          </select>
          <input name="source" placeholder="Source (farm_bureau, il_farm_link, cold…)" />
          <input name="email" type="email" placeholder="Email" />
          <input name="phone" placeholder="Phone" />
          <input name="nextActionDate" type="date" />
          <input name="nextAction" placeholder="Next action" className="col-span-2" />
          <textarea name="notes" placeholder="Notes" rows={2} className="col-span-2" />
          <button type="submit" className="pill pill--sm justify-self-start">Add</button>
        </form>
        <p className="text-[12.5px] text-ink-soft mt-3">
          Boundaries: no purchased lists, no scraping personal data, no automated DMs. Every
          outreach message is written or approved by a human. Drafts live in docs/growth/.
        </p>
      </section>
    </>
  );
}
