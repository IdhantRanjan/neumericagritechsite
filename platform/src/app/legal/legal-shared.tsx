import type { ReactNode } from "react";

/**
 * Shared legal-page scaffolding. Every legal document renders the
 * attorney-review banner until counsel clears it — that state is tracked in
 * docs/DEPENDENCIES.md and must be flipped by a human, deliberately.
 */
export const ATTORNEY_REVIEWED = false;

export function DraftBanner() {
  if (ATTORNEY_REVIEWED) return null;
  return (
    <div className="border-2 border-dashed border-[var(--amber)] bg-[var(--amber-tint)] rounded-[8px] p-4 mb-8">
      <p className="label !text-[var(--amber)] mb-1">Draft — not yet reviewed by an attorney</p>
      <p className="text-[13.5px] text-ink-soft">
        This document is a working draft prepared while Neumeric is in pilot with early-access
        farmers. It states our actual practices honestly, but it has not yet been reviewed by
        licensed legal counsel and may change after that review. Questions?{" "}
        <a href="mailto:idhantran@gmail.com" className="text-forest underline">
          idhantran@gmail.com
        </a>
        .
      </p>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-[1.35rem] mb-3">{title}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-ink-soft [&_strong]:text-ink">{children}</div>
    </section>
  );
}

export function LegalShell({
  eyebrow,
  title,
  updated,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="max-w-[760px] mx-auto pt-10">
      <p className="label mb-3">{eyebrow}</p>
      <h1 className="text-[2.2rem] sm:text-[2.6rem] mb-2">{title}</h1>
      <p className="label mb-8">Last updated {updated}</p>
      <DraftBanner />
      {children}
    </div>
  );
}
