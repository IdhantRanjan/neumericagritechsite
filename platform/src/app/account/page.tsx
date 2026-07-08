import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getDb, tables as t } from "@/db";
import { resolveSession } from "@/lib/auth";
import { signOut, signOutEverywhere } from "@/app/auth/actions";
import { Meta, PageHeader, Tag } from "@/components/ui";
import { PasswordForm } from "./password-form";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const sess = await resolveSession();
  if (!sess) redirect("/signin");
  const db = await getDb();

  const [sessions, events, members] = await Promise.all([
    db
      .select()
      .from(t.sessions)
      .where(eq(t.sessions.userId, sess.user.id))
      .orderBy(desc(t.sessions.createdAt))
      .limit(20),
    db
      .select()
      .from(t.loginEvents)
      .where(eq(t.loginEvents.email, sess.user.email))
      .orderBy(desc(t.loginEvents.at))
      .limit(25),
    db.select().from(t.memberships).where(eq(t.memberships.userId, sess.user.id)),
  ]);
  const active = sessions.filter((s) => !s.revokedAt && s.expiresAt > new Date().toISOString());

  return (
    <>
      <PageHeader eyebrow="Account" title={sess.user.email} lede="Sign-in methods, devices, and your account's activity log." />

      <div className="max-w-[760px] space-y-8">
        <section className="card grid grid-cols-2 lg:grid-cols-4 gap-6 p-6">
          <Meta k="Email" v={sess.user.emailVerifiedAt ? "Verified" : "Unverified"} sub={sess.user.email} />
          <Meta k="Farms" v={String(members.length)} sub={members.map((m) => m.role).join(", ") || "none yet"} />
          <Meta k="Active devices" v={String(active.length)} />
          <Meta k="Password" v={sess.user.passwordHash ? "Set" : "Not set"} sub="magic links always work" />
        </section>

        <section className="card p-6">
          <p className="label mb-3">Password (optional)</p>
          <p className="text-[14px] text-ink-soft mb-4">
            Email links are the primary way in. A password is a fallback for spotty cell coverage —
            at least 10 characters.
          </p>
          <PasswordForm />
        </section>

        <section className="card p-6">
          <p className="label mb-3">Devices signed in</p>
          <div className="space-y-2">
            {active.map((s) => (
              <div key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ash last:border-0 pb-2">
                <span className="text-[14px]">{s.userAgent?.slice(0, 70) ?? "Unknown device"}</span>
                <span className="label">
                  since {s.createdAt.slice(0, 10)}
                  {s.id === sess.session.id ? " · this device" : ""}
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-5">
            <form action={signOut}>
              <button className="pill pill--quiet">Sign out</button>
            </form>
            <form action={signOutEverywhere}>
              <button className="pill pill--quiet">Sign out everywhere</button>
            </form>
          </div>
        </section>

        <section className="card p-6">
          <p className="label mb-3">Account activity</p>
          <p className="text-[13px] text-ink-soft mb-3">
            Every sign-in and sign-out on your account, newest first — if something here
            wasn&rsquo;t you, sign out everywhere and email the Neumeric team.
          </p>
          <div className="space-y-1.5">
            {events.map((e) => (
              <div key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                <span>
                  <Tag tone={e.kind === "password_failed" ? "amber" : "ash"}>{e.kind.replaceAll("_", " ")}</Tag>
                </span>
                <span className="text-ink-soft font-mono text-[12px]">
                  {e.at.replace("T", " ").slice(0, 16)}
                  {e.ip ? ` · ${e.ip}` : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
