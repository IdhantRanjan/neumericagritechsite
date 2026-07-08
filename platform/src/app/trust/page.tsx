import Link from "next/link";
import { LegalSection } from "../legal/legal-shared";

export const metadata = { title: "Security & Trust — Neumeric" };

/**
 * The trust page doubles as a sales asset for lenders/carriers: it explains,
 * in checkable terms, why a number produced by Neumeric can be relied on.
 * Everything here must remain true — it mirrors docs/SECURITY.md and
 * docs/ENGINES.md, which are the engineering source of truth.
 */
export default function TrustPage() {
  return (
    <div className="max-w-[760px] mx-auto pt-10">
      <p className="label mb-3">Security & Trust</p>
      <h1 className="text-[2.2rem] sm:text-[2.6rem] mb-2">
        Why you can <em className="text-forest">check our work</em>
      </h1>
      <p className="text-ink-soft text-[16px] mb-10 max-w-[640px]">
        Neumeric produces numbers that money depends on — claim evidence, trigger evaluations,
        yield estimates. Our design rule: every such number must be deterministic, versioned,
        reproducible, and auditable. Not &ldquo;trust us&rdquo; — <em>check us</em>.
      </p>

      <LegalSection title="Evidence that can't be quietly edited">
        <p>
          Every money-relevant artifact — an uploaded photo, a satellite observation, a
          computed condition record, a trigger evaluation, a recorded outcome — is written to
          an append-only, hash-chained provenance log: each entry cryptographically commits to
          the one before it, and entries are HMAC-signed server-side. Change any historical
          record and every subsequent hash breaks, visibly. Corrections are new records that
          say what they supersede — history is never rewritten.
        </p>
        <p>
          Photos are stored content-addressed: the SHA-256 of the bytes is the storage key,
          recorded at ingest, printed on the evidence packet. Anyone holding the original file
          can re-hash it and confirm it&rsquo;s the same photo.
        </p>
      </LegalSection>

      <LegalSection title="Satellite analysis you can reproduce">
        <p>
          Damage detection runs on public Sentinel-2 imagery under a versioned methodology:
          fixed cloud-masking rules, fixed index math, fixed statistical thresholds, pinned by
          a parameter hash stamped on every output. Same scenes + same methodology version =
          byte-identical result. Each record lists the exact scene IDs and asset references it
          used — a skeptical adjuster (or carrier) can pull the same public scenes and recompute.
        </p>
        <p>
          Uncertainty is real and disclosed: cloud coverage, baseline strength, and effect size
          drive a stated confidence; when coverage is poor the record says so instead of
          pretending. Where the USDA Cropland Data Layer is available, packets also state what
          the government&rsquo;s own crop map says was planted inside the boundary.
        </p>
      </LegalSection>

      <LegalSection title="Models with honest error bars">
        <p>
          Where we deploy a trained model (corn yield from satellite features, trained on USDA
          NASS county records), the error shown in-product is the cross-validated error from
          held-out years and counties — the worse of the two — never a cherry-picked number.
          Where we don&rsquo;t have the data to validate something, we don&rsquo;t ship a
          number for it. There are no fabricated accuracy claims anywhere in this product.
        </p>
      </LegalSection>

      <LegalSection title="Account & data security">
        <p>
          Passwordless email sign-in (single-use, 15-minute links; only token hashes stored),
          optional scrypt-hashed passwords, httpOnly session cookies with per-device
          revocation, and a per-account sign-in log you can inspect at any time. Role-based
          access per farm (owner / member / advisor / read-only partner). Tenant isolation is
          covered by an automated test suite run before every release. Details:{" "}
          <Link href="/legal/privacy" className="text-forest underline">privacy policy</Link>{" "}
          and the SECURITY.md in our repository.
        </p>
      </LegalSection>

      <LegalSection title="What we don't claim">
        <p>
          No customer testimonials or traction numbers appear anywhere because we&rsquo;re
          pre-revenue and in pilot — when numbers show up, they&rsquo;ll be real. Parametric
          triggers are preview-only until a licensed carrier partner underwrites them. The
          marketing module analyzes scenarios; it does not advise trades. Deadline data
          carries a &ldquo;verify with your agent&rdquo; warning until our dates are verified
          against RMA&rsquo;s systems each season.
        </p>
      </LegalSection>

      <LegalSection title="For lenders and carriers">
        <p>
          The audit trail is the product: methodology hashes, scene-level provenance,
          reproducible computation, and a dispute log that shows exactly what fired and why.
          If your risk team wants to kick the tires, email{" "}
          <a href="mailto:idhantran@gmail.com" className="text-forest underline">
            idhantran@gmail.com
          </a>{" "}
          — we&rsquo;ll walk through the chain on a real record.
        </p>
      </LegalSection>
    </div>
  );
}
