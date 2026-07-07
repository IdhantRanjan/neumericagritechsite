import { requireOperation } from "@/lib/current-op";
import { leaveWorkspace } from "@/app/actions";
import { Meta, PageHeader, Tag } from "@/components/ui";
import { CopyLink } from "@/components/copy-link";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const op = await requireOperation();
  const { created } = await searchParams;

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title={op.name}
        lede={created ? "Your workspace is ready. One thing before anything else: save your private link below." : undefined}
      />

      <div className="max-w-[760px] space-y-8">
        <section className="card p-6 border-l-4 border-l-forest">
          <p className="label mb-2">Your private workspace link — save it now</p>
          <CopyLink token={op.accessToken ?? ""} />
          <p className="text-[14px] text-ink-soft mt-3">
            This link signs you in on any device (phone in the truck included). Treat it like
            a key: anyone with the link can see your farm records. Bookmark it, text it to
            yourself, or store it in notes. Lost links can be restored by the Neumeric team.
          </p>
        </section>

        <section className="card grid grid-cols-2 lg:grid-cols-4 gap-6 p-6">
          <Meta k="State" v={op.state} sub={op.counties.join(", ")} />
          <Meta k="Entity" v={op.entityType.replaceAll("_", " ")} />
          <Meta k="Reminders" v={op.contactEmail ? "Email set" : "—"} sub={op.contactEmail ?? "no email on file"} />
          <Meta
            k="Workspace type"
            v={op.isDemo ? <Tag tone="demo">Demo</Tag> : <Tag tone="strong">Live</Tag>}
          />
        </section>

        <section className="card p-6">
          <p className="label mb-3">Program-eligibility profile</p>
          <div className="flex flex-wrap gap-2">
            <Tag tone={op.hasBaseAcres ? "strong" : "possible"}>FSA base acres: {op.hasBaseAcres ? "yes" : "no"}</Tag>
            <Tag tone={op.storesGrainOnFarm ? "strong" : "possible"}>On-farm storage: {op.storesGrainOnFarm ? "yes" : "no"}</Tag>
            <Tag tone={op.usesCoverCrops ? "strong" : "possible"}>Cover crops: {op.usesCoverCrops ? "yes" : "no"}</Tag>
            <Tag tone={op.usesNoTill ? "strong" : "possible"}>No-till: {op.usesNoTill ? "yes" : "no"}</Tag>
          </div>
        </section>

        <form action={leaveWorkspace}>
          <button type="submit" className="pill pill--quiet">Sign out of this workspace</button>
        </form>
      </div>
    </>
  );
}
