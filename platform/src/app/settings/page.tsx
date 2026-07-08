import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { getDb, tables as t } from "@/db";
import { requireAccess, canManage } from "@/lib/current-op";
import { leaveWorkspace } from "@/app/actions";
import { removeMember, rotateAccessLink, signOut } from "@/app/auth/actions";
import { Meta, PageHeader, Tag } from "@/components/ui";
import { CopyLink } from "@/components/copy-link";
import { ClaimAccountForm, InviteForm } from "./settings-forms";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const a = await requireAccess();
  const op = a.op;
  const { created } = await searchParams;
  const db = await getDb();

  const members = await db
    .select()
    .from(t.memberships)
    .where(eq(t.memberships.operationId, op.id));
  const memberUsers =
    members.length > 0
      ? await db
          .select()
          .from(t.users)
          .where(inArray(t.users.id, members.map((m) => m.userId)))
      : [];
  const emailOf = (userId: string) => memberUsers.find((u) => u.id === userId)?.email ?? "—";
  const hasOwnerAccount = members.some((m) => m.role === "owner");
  const manage = canManage(a);

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title={op.name}
        lede={
          created
            ? "Your workspace is ready. Two things before anything else: save your private link, and attach your email so you can always get back in."
            : undefined
        }
      />

      <div className="max-w-[760px] space-y-8">
        {!op.isDemo && !hasOwnerAccount && (
          <section className="card p-6 border-l-4 border-l-forest">
            <p className="label mb-2">Attach your email — recommended</p>
            <p className="text-[14px] text-ink-soft mb-4">
              Right now this farm is only reachable through its private link. Add your email and
              you can sign in from any device with a one-time link — and invite family members or
              your agronomist with their own access.
            </p>
            <ClaimAccountForm />
          </section>
        )}

        {!op.isDemo && (
          <section className="card p-6">
            <p className="label mb-2">People on this farm</p>
            {members.length === 0 ? (
              <p className="text-[14px] text-ink-soft mb-4">
                No accounts attached yet — access is via the private link only.
              </p>
            ) : (
              <div className="space-y-2 mb-5">
                {members.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-ash last:border-0 pb-2"
                  >
                    <span className="text-[14px]">{emailOf(m.userId)}</span>
                    <span className="flex items-center gap-3">
                      <Tag tone={m.role === "owner" ? "strong" : "possible"}>{m.role}</Tag>
                      {manage && m.role !== "owner" && (
                        <form action={removeMember.bind(null, m.id)}>
                          <button className="label !text-[11px] underline hover:text-[var(--red)]">
                            remove
                          </button>
                        </form>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {manage ? (
              <>
                <p className="label mb-3">Invite someone</p>
                <InviteForm />
              </>
            ) : (
              <p className="text-[13px] text-ink-soft">Only the farm owner can invite people.</p>
            )}
          </section>
        )}

        <section className="card p-6">
          <p className="label mb-2">Private workspace link</p>
          <CopyLink token={op.accessToken ?? ""} />
          <p className="text-[14px] text-ink-soft mt-3">
            This link signs you in on any device. Treat it like a key: anyone with the link can
            see your farm records{a.user ? "" : " — attaching your email above is the safer way in"}.
          </p>
          {manage && (
            <form action={rotateAccessLink} className="mt-3">
              <button className="label !text-[11px] underline hover:text-forest">
                Rotate this link (if it leaked)
              </button>
            </form>
          )}
        </section>

        <section className="card grid grid-cols-2 lg:grid-cols-4 gap-6 p-6">
          <Meta k="State" v={op.state} sub={op.counties.join(", ")} />
          <Meta k="Entity" v={op.entityType.replaceAll("_", " ")} />
          <Meta k="Your role" v={a.role} sub={a.user?.email ?? "via private link"} />
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

        <div className="flex flex-wrap gap-3">
          {a.user ? (
            <>
              <Link href="/account" className="pill pill--quiet">
                Account & devices
              </Link>
              <form action={signOut}>
                <button type="submit" className="pill pill--quiet">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <form action={leaveWorkspace}>
              <button type="submit" className="pill pill--quiet">
                Sign out of this workspace
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
