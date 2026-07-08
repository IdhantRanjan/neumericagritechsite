"use client";

import { useActionState, useState } from "react";
import { requestMagicLink, signInWithPassword } from "@/app/auth/actions";

export function SignInForms() {
  const [mode, setMode] = useState<"magic" | "password">("magic");
  const [magicState, magicAction, magicPending] = useActionState(requestMagicLink, {});
  const [pwState, pwAction, pwPending] = useActionState(signInWithPassword, {});

  return (
    <div className="card p-6 mt-8">
      {mode === "magic" ? (
        <form action={magicAction} className="space-y-4">
          <div>
            <label htmlFor="si-email" className="label block mb-1.5">
              Email
            </label>
            <input
              id="si-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full"
              placeholder="you@farm.com"
            />
          </div>
          {magicState.error && (
            <p className="text-[13px] text-[var(--red)]" role="alert">
              {magicState.error}
            </p>
          )}
          {magicState.ok && (
            <p className="text-[13px] text-forest-ink" role="status">
              {magicState.ok}
            </p>
          )}
          {magicState.devLink && (
            <p className="text-[12px] text-ink-soft break-all">
              <span className="tag tag--amber">dev only</span> email isn&rsquo;t configured, use:{" "}
              <a className="text-forest underline" href={magicState.devLink}>
                {magicState.devLink}
              </a>
            </p>
          )}
          <button type="submit" disabled={magicPending} className="pill pill--solid w-full justify-center">
            {magicPending ? "Sending…" : "Email me a sign-in link"}
          </button>
          <p className="text-[13px] text-ink-soft text-center">
            No password needed — the link signs you in.{" "}
            <button type="button" className="text-forest underline" onClick={() => setMode("password")}>
              Use a password instead
            </button>
          </p>
        </form>
      ) : (
        <form action={pwAction} className="space-y-4">
          <div>
            <label htmlFor="pw-email" className="label block mb-1.5">
              Email
            </label>
            <input id="pw-email" name="email" type="email" required autoComplete="email" className="w-full" />
          </div>
          <div>
            <label htmlFor="pw-pass" className="label block mb-1.5">
              Password
            </label>
            <input
              id="pw-pass"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full"
            />
          </div>
          {pwState.error && (
            <p className="text-[13px] text-[var(--red)]" role="alert">
              {pwState.error}
            </p>
          )}
          <button type="submit" disabled={pwPending} className="pill pill--solid w-full justify-center">
            {pwPending ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-[13px] text-ink-soft text-center">
            <button type="button" className="text-forest underline" onClick={() => setMode("magic")}>
              Email me a link instead
            </button>{" "}
            (works even without a password)
          </p>
        </form>
      )}
    </div>
  );
}
