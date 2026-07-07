import Link from "next/link";
import { requireOperation } from "@/lib/current-op";
import { getFields, getSeasonsByField } from "@/lib/data";
import { FieldShape, PageHeader, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function FieldsPage() {
  const op = await requireOperation();
  const fields = await getFields(op.id);
  const seasonsByField = await Promise.all(fields.map((f) => getSeasonsByField(f.id)));

  return (
    <>
      <PageHeader
        eyebrow="Land & crops"
        title="Your"
        accent="fields"
        lede="Boundaries, FSA numbers, and what's planted where — the base records every report, claim, and program filing builds on."
      />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {fields.map((f, i) => {
          const seasons = seasonsByField[i];
          return (
            <Link key={f.id} href={`/fields/${f.id}`} className="card p-5 hover:border-forest transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[1.35rem]">{f.name}</h2>
                  <p className="text-[13px] text-ink-soft mt-0.5">
                    {f.county} County · {f.acres} acres
                  </p>
                </div>
                <FieldShape boundary={f.boundary} className="w-16 h-16 shrink-0" />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {seasons.map((s) => (
                  <Tag key={s.id} tone={s.reportedAcres != null ? "done" : "urgent"}>
                    {s.crop} {s.year} · {s.reportedAcres != null ? "reported" : "unreported"}
                  </Tag>
                ))}
              </div>
              <p className="label mt-4">
                {f.fsaFarmNumber
                  ? `FSA farm ${f.fsaFarmNumber}${f.fsaTractNumber ? ` · tract ${f.fsaTractNumber}` : ""}${f.fsaFieldNumber ? ` · field ${f.fsaFieldNumber}` : ""}`
                  : "FSA numbers not on file yet"}
              </p>
            </Link>
          );
        })}
        {fields.length === 0 && (
          <p className="text-ink-soft text-[15px]">No fields yet.</p>
        )}
      </div>
    </>
  );
}
