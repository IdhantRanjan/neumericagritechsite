import { LegalSection, LegalShell } from "../legal-shared";

export const metadata = { title: "Terms of Service — Neumeric" };

export default function TermsPage() {
  return (
    <LegalShell eyebrow="Legal" title={<>Terms of <em className="text-forest">Service</em></>} updated="July 7, 2026">
      <LegalSection title="What Neumeric is — and is not">
        <p>
          Neumeric is <strong>decision-support and documentation software</strong> for farm
          operations: deadline tracking, imagery-based evidence packets, program-eligibility
          matching, and grain-marketing scenario analysis. Using it, you agree to these terms.
        </p>
        <p>Just as important, Neumeric is <strong>not</strong>:</p>
        <p>
          <strong>Not insurance or insurance adjusting.</strong> We do not sell, underwrite, or
          adjust insurance. Evidence packets are documentation you choose to share with your
          insurer or agent; they do not determine coverage or payment, and we are not a public
          adjuster negotiating on your behalf.
        </p>
        <p>
          <strong>Not trading, investment, or financial advice.</strong> The marketing module
          shows scenarios computed from numbers you enter. It never predicts prices and never
          tells you to buy, sell, or hedge. Decisions and their outcomes are yours. Neumeric is
          not registered as a Commodity Trading Advisor and the product is deliberately built
          to provide impersonal, non-tailored analysis.
        </p>
        <p>
          <strong>Not legal or tax advice.</strong> Deadline dates and program criteria are
          compiled from public USDA/RMA/FSA sources and can lag or contain errors —{" "}
          <strong>verify dates with your crop-insurance agent or FSA office before relying on
          them</strong>. Missing a deadline has real consequences and responsibility for
          meeting deadlines stays with you.
        </p>
      </LegalSection>

      <LegalSection title="Early-access reality">
        <p>
          Neumeric is pre-revenue, in validation with pilot farmers, currently free of charge.
          The service may change, break, or be discontinued; we&rsquo;ll communicate honestly
          and give you your data if we wind anything down. Sample/demo data is fictional and
          labeled as such.
        </p>
      </LegalSection>

      <LegalSection title="Your account & acceptable use">
        <p>
          Keep your sign-in links and passwords private; you&rsquo;re responsible for activity
          under your account and for the accuracy of what you enter. Don&rsquo;t: access
          another operation&rsquo;s data, probe or overload the service, upload unlawful
          content or malware, misrepresent evidence (altering imagery or falsifying records
          defeats the product&rsquo;s entire purpose and is grounds for immediate termination),
          or resell the service without a written agreement.
        </p>
      </LegalSection>

      <LegalSection title="Evidence integrity">
        <p>
          Records that anchor money — imagery, condition records, trigger evaluations, outcome
          labels — are append-only and cryptographically chained. You can add corrections;
          nobody (including us) silently rewrites history. By uploading imagery you confirm you
          took it (or have the right to it) and that it depicts what you say it depicts.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimers & limitation of liability">
        <p>
          The service is provided <strong>&ldquo;as is&rdquo; without warranties</strong> of
          any kind, express or implied, including merchantability, fitness for a particular
          purpose, and non-infringement. Satellite analysis carries stated uncertainty; cloud
          cover, revisit gaps, and model limitations are real and are surfaced rather than
          hidden — but no analysis is guaranteed correct.
        </p>
        <p>
          To the maximum extent permitted by law, Neumeric&rsquo;s total liability for any
          claims arising out of the service is limited to the greater of $100 or the amount you
          paid us in the twelve months before the claim, and we are not liable for indirect,
          incidental, special, consequential, or punitive damages — including denied claims,
          missed deadlines, marketing losses, or lost profits. Some jurisdictions don&rsquo;t
          allow certain limitations, so parts of this may not apply to you.
        </p>
      </LegalSection>

      <LegalSection title="Disputes">
        <p>
          Illinois law governs, venue in the state or federal courts located in Illinois. Talk
          to us first — most disagreements are resolvable by email in a week. [Arbitration
          clause deliberately left for attorney review — whether to include one at all is a
          decision for counsel, not software.]
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          Material changes are emailed to account holders at least 14 days before they take
          effect. Continued use after that is acceptance.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
