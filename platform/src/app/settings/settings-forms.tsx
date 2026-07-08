"use client";

import { useActionState } from "react";
import { claimWorkspace, inviteMember } from "@/app/auth/actions";

export function ClaimAccountForm() {
  const [state, action, pending] = useActionState(claimWorkspace, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[220px]">
        <label htmlFor="claim-email" className="label block mb-1.5">
          Your email
        </label>
        <input id="claim-email" name="email" type="email" required autoComplete="email" className="w-full" />
      </div>
      <button type="submit" disabled={pending} className="pill pill--sm">
        {pending ? "Sending…" : "Send confirmation link"}
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
      {state.devLink && (
        <p className="w-full text-[12px] text-ink-soft break-all">
          <span className="tag tag--amber">dev only</span>{" "}
          <a className="text-forest underline" href={state.devLink}>
            {state.devLink}
          </a>
        </p>
      )}
    </form>
  );
}

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteMember, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[200px]">
        <label htmlFor="inv-email" className="label block mb-1.5">
          Email
        </label>
        <input id="inv-email" name="email" type="email" required className="w-full" />
      </div>
      <div>
        <label htmlFor="inv-role" className="label block mb-1.5">
          Role
        </label>
        <select id="inv-role" name="role" defaultValue="member">
          <option value="member">Member — day-to-day access</option>
          <option value="advisor">Advisor — read + record outcomes</option>
          <option value="partner">Partner — read-only (lender/co-op)</option>
        </select>
      </div>
      <button type="submit" disabled={pending} className="pill pill--sm">
        {pending ? "Inviting…" : "Invite"}
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
      {state.devLink && (
        <p className="w-full text-[12px] text-ink-soft break-all">
          <span className="tag tag--amber">dev only</span>{" "}
          <a className="text-forest underline" href={state.devLink}>
            {state.devLink}
          </a>
        </p>
      )}
    </form>
  );
}
