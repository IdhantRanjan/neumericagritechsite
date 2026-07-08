import Link from "next/link";

export default function NotFound() {
  return (
    <div className="max-w-[560px] mx-auto pt-20 text-center">
      <p className="label mb-4">404</p>
      <h1 className="text-[2rem]">
        Nothing <em className="text-forest">here</em>
      </h1>
      <p className="mt-4 text-ink-soft text-[15px]">
        That page doesn&rsquo;t exist — or belongs to a different farm&rsquo;s workspace.
      </p>
      <div className="flex gap-3 justify-center mt-8">
        <Link href="/" className="pill pill--solid">
          Back to overview
        </Link>
        <Link href="/welcome" className="pill pill--quiet">
          Sign in
        </Link>
      </div>
    </div>
  );
}
