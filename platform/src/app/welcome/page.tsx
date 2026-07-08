import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ invalid?: string }>;
}) {
  const { invalid } = await searchParams;
  return (
    <div className="max-w-[620px] mx-auto pt-16 sm:pt-24 text-center">
      {invalid && (
        <p className="tag tag--red mb-8">
          That workspace link isn&rsquo;t valid — check it and try again
        </p>
      )}
      <p className="label mb-4">Neumeric farm platform</p>
      <h1 className="text-[2.4rem] sm:text-[3.2rem]">
        Your farm&rsquo;s paperwork, <em className="text-forest">handled</em>
      </h1>
      <p className="mt-5 text-ink-soft font-light text-[17px] max-w-[520px] mx-auto">
        Insurance deadlines, damage evidence, program money, and grain marketing clarity —
        built for the farmer&rsquo;s side of the table.
      </p>

      <div className="flex flex-wrap gap-4 justify-center mt-10">
        <Link href="/setup" className="pill pill--solid">
          Set up your farm
        </Link>
        <Link href="/join/demo" className="pill pill--quiet">
          Look around the demo first
        </Link>
      </div>

      <div className="card p-5 mt-14 text-left">
        <p className="label mb-2">Already set up?</p>
        <p className="text-[14px] text-ink-soft">
          <Link href="/signin" className="text-forest underline">Sign in with your email</Link>{" "}
          — we&rsquo;ll send you a one-time link, no password needed. Your saved private
          workspace link keeps working too. Lost both? Email{" "}
          <a href="mailto:idhantran@gmail.com" className="text-forest">the Neumeric team</a>.
        </p>
      </div>

      <p className="label mt-10">
        Early access · built with Illinois farmers · no charge while we validate
      </p>
    </div>
  );
}
