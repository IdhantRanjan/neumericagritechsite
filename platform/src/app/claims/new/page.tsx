import { requireOperation } from "@/lib/current-op";
import { getFields } from "@/lib/data";
import { createClaim } from "@/app/actions";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const DAMAGE_TYPES = ["hail", "flood", "drought", "wind", "disease", "pest", "other"];

export default async function NewClaimPage() {
  const op = await requireOperation();
  const fields = await getFields(op.id);

  return (
    <>
      <PageHeader
        eyebrow="Step 1 of 2 · event details"
        title="Document"
        accent="damage"
        lede="Two minutes now, evidence forever. Tell us what happened and where — then add photos and we'll build the verified record."
      />

      <form action={createClaim} className="card p-6 max-w-[620px] space-y-5">
        <div>
          <label className="label block mb-2" htmlFor="fieldId">Field</label>
          <select id="fieldId" name="fieldId" required defaultValue="">
            <option value="" disabled>Choose a field…</option>
            {fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} — {f.acres} ac, {f.county} Co.
              </option>
            ))}
          </select>
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label className="label block mb-2" htmlFor="damageType">What happened</label>
            <select id="damageType" name="damageType" required defaultValue="hail">
              {DAMAGE_TYPES.map((d) => (
                <option key={d} value={d} className="capitalize">{d}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label block mb-2" htmlFor="eventDate">When</label>
            <input
              id="eventDate"
              name="eventDate"
              type="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </div>
        </div>

        <div>
          <label className="label block mb-2" htmlFor="narrative">
            What you saw (your words become part of the record)
          </label>
          <textarea
            id="narrative"
            name="narrative"
            rows={4}
            placeholder="Storm came through around 8pm. Worst of it looks like the west side…"
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          <p className="label max-w-[280px]">
            Next: add photos — geotags and timestamps are captured automatically
          </p>
          <button type="submit" className="pill pill--solid">Create record</button>
        </div>
      </form>
    </>
  );
}
