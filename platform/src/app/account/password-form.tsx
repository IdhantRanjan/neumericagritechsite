"use client";

import { useActionState } from "react";
import { setPassword } from "@/app/auth/actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState(setPassword, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[220px]">
        <label htmlFor="new-pass" className="label block mb-1.5">
          New password
        </label>
        <input
          id="new-pass"
          name="password"
          type="password"
          minLength={10}
          required
          autoComplete="new-password"
          className="w-full"
        />
      </div>
      <button type="submit" disabled={pending} className="pill pill--sm">
        {pending ? "Saving…" : "Set password"}
      </button>
      {state.error && (
        <p className="w-full text-[13px] text-[var(--red)]" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="w-full text-[13px] text-forest-ink" role="status">
          {state.ok}
        </p>
      )}
    </form>
  );
}
