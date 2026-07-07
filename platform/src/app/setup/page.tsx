import { createOperation } from "@/app/actions";
import { FieldRows } from "@/components/field-rows";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATES = ["IL", "IA", "IN", "WI", "MN", "MO", "OH", "NE", "KS", "SD", "ND", "MI", "KY"];

export default function SetupPage() {
  return (
    <>
      <PageHeader
        eyebrow="Set up · about 3 minutes"
        title="Tell us about your"
        accent="farm"
        lede="Fields and crops first — that's enough to start tracking your deadlines and finding program money. You can add boundaries, policies, and marketing numbers any time."
      />

      <form action={createOperation} className="max-w-[760px] space-y-8">
        <section className="card p-6 space-y-5">
          <p className="label">The operation</p>
          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <label className="label block mb-2" htmlFor="name">Farm / operation name</label>
              <input id="name" name="name" required placeholder="Smith Family Farms" />
            </div>
            <div>
              <label className="label block mb-2" htmlFor="email">Email (for deadline reminders)</label>
              <input id="email" name="email" type="email" placeholder="you@example.com" />
            </div>
            <div>
              <label className="label block mb-2" htmlFor="state">State</label>
              <select id="state" name="state" defaultValue="IL">
                {STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label block mb-2" htmlFor="counties">County (or counties, comma-separated)</label>
              <input id="counties" name="counties" required placeholder="DeKalb, Kane" />
            </div>
          </div>
          <p className="text-[13px] text-ink-soft">
            Deadline rules currently cover Illinois corn &amp; soybeans in detail — other states
            get general federal dates while we expand state coverage.
          </p>
        </section>

        <section>
          <p className="label mb-4">Your fields (rough acres are fine to start)</p>
          <FieldRows />
        </section>

        <section className="card p-6">
          <p className="label mb-4">A few questions that unlock program matches</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              ["hasBaseAcres", "The farm has FSA base acres"],
              ["storesGrainOnFarm", "We store grain on-farm (bins)"],
              ["usesCoverCrops", "We plant cover crops (or plan to)"],
              ["usesNoTill", "We no-till or strip-till"],
            ].map(([name, label]) => (
              <label key={name} className="flex items-center gap-3 text-[15px] cursor-pointer">
                <input type="checkbox" name={name} className="!w-auto accent-[var(--forest)]" />
                {label}
              </label>
            ))}
          </div>
        </section>

        <div className="flex items-center justify-between gap-4">
          <p className="label max-w-[340px]">
            You&rsquo;ll get a private workspace link — save it, it&rsquo;s how you sign in
          </p>
          <button type="submit" className="pill pill--solid">Create my workspace</button>
        </div>
      </form>
    </>
  );
}
