import Link from "next/link";
import { requireOperation } from "@/lib/current-op";
import { getClaims, getFields } from "@/lib/data";
import { PageHeader, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export default async function ClaimsPage() {
  const op = await requireOperation();
  const [claims, fields] = await Promise.all([getClaims(op.id), getFields(op.id)]);

  return (
    <>
      <PageHeader
        eyebrow="Insurance advocate"
        title="Damage, documented so it"
        accent="holds"
        lede="When something hits a field, photograph it fast. Neumeric turns geotagged imagery into a verified condition record and a claim packet your adjuster can't wave away."
        actions={
          <Link href="/claims/new" className="pill pill--solid">
            Document new damage
          </Link>
        }
      />

      <ul className="card divide-y divide-ash max-w-[820px]">
        {claims.map((c) => {
          const field = fields.find((f) => f.id === c.fieldId);
          return (
            <li key={c.id}>
              <Link
                href={`/claims/${c.id}`}
                className="p-5 flex items-center gap-4 hover:bg-[var(--forest-tint)] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium capitalize text-[16px]">
                    {c.damageType} — {field?.name}
                  </p>
                  <p className="text-[14px] text-ink-soft mt-0.5">
                    Event {fmt(c.eventDate)} · discovered {fmt(c.discoveredDate)} ·{" "}
                    {c.fcrIds.length} verified record{c.fcrIds.length === 1 ? "" : "s"}
                  </p>
                </div>
                <Tag tone={c.status}>{c.status.replace("_", " ")}</Tag>
              </Link>
            </li>
          );
        })}
        {claims.length === 0 && (
          <li className="p-5 text-ink-soft">No claims yet — hopefully it stays that way.</li>
        )}
      </ul>

      <div className="card p-5 mt-8 max-w-[820px] border-l-4 border-l-forest">
        <p className="label mb-1">The 72-hour rule</p>
        <p className="text-[15px] text-ink-soft">
          Your policy requires notice to your agent within 72 hours of discovering damage —
          and photos before you touch the crop. Document first, then call.
        </p>
      </div>
    </>
  );
}
