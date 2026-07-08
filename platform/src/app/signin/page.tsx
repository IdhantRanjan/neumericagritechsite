import { redirect } from "next/navigation";
import { currentAccess } from "@/lib/current-op";
import { SignInForms } from "./signin-forms";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; signedout?: string }>;
}) {
  const { error, signedout } = await searchParams;
  const a = await currentAccess();
  if (a && !a.op.isDemo) redirect("/");

  return (
    <div className="max-w-[440px] mx-auto pt-14 sm:pt-20">
      <p className="label mb-3 text-center">Neumeric farm platform</p>
      <h1 className="text-[2.2rem] sm:text-[2.6rem] text-center">
        Sign <em className="text-forest">in</em>
      </h1>

      {error === "expired" && (
        <p className="tag tag--amber mt-6 block text-center" role="alert">
          That link expired or was already used — request a fresh one below.
        </p>
      )}
      {error === "invalid" && (
        <p className="tag tag--red mt-6 block text-center" role="alert">
          That link isn&rsquo;t valid.
        </p>
      )}
      {signedout === "all" && (
        <p className="tag tag--forest mt-6 block text-center" role="status">
          Signed out on every device.
        </p>
      )}

      <SignInForms />

      <p className="text-[13px] text-ink-soft text-center mt-10">
        New here?{" "}
        <a href="/setup" className="text-forest underline">
          Set up your farm
        </a>{" "}
        or{" "}
        <a href="/join/demo" className="text-forest underline">
          look around the demo
        </a>
        .
      </p>
    </div>
  );
}
