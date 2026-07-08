"use client";

/**
 * Route-level error boundary. Server errors surface here with their message
 * only when they're deliberate, human-readable guards (thrown from actions
 * with friendly text); otherwise the farmer sees a calm generic state and
 * the details stay in the server logs. No stack traces to users, ever.
 */
import { useEffect } from "react";
import Link from "next/link";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // client-side breadcrumb; the server side already logged via instrumentation
    console.error("route error", error.digest ?? error.message);
  }, [error]);

  // Next strips server error messages in production unless they're digest-only;
  // friendly guard messages from server actions come through on the message.
  const friendly =
    error.message && !error.digest && error.message.length < 200 ? error.message : null;

  return (
    <div className="max-w-[560px] mx-auto pt-20 text-center">
      <p className="label mb-4">Something went sideways</p>
      <h1 className="text-[2rem]">
        That didn&rsquo;t <em className="text-forest">work</em>
      </h1>
      <p className="mt-4 text-ink-soft text-[15px]">
        {friendly ??
          "The error is logged on our side. Try again — if it keeps happening, email the Neumeric team and we'll sort it out."}
      </p>
      <div className="flex gap-3 justify-center mt-8">
        <button onClick={reset} className="pill pill--solid">
          Try again
        </button>
        <Link href="/" className="pill pill--quiet">
          Back to overview
        </Link>
      </div>
      {error.digest && (
        <p className="label mt-8 !text-[10px]">error ref: {error.digest}</p>
      )}
    </div>
  );
}
