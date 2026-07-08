import { LegalSection, LegalShell } from "../legal-shared";

export const metadata = { title: "Privacy Policy — Neumeric" };

export default function PrivacyPage() {
  return (
    <LegalShell eyebrow="Legal" title={<>Privacy <em className="text-forest">Policy</em></>} updated="July 7, 2026">
      <LegalSection title="The plain-English version">
        <p>
          Your farm data is yours. We collect what the product needs to work — your operation
          details, field boundaries, imagery you upload, and the positions you enter — and we
          use it to do the job you asked for: deadlines, claim evidence, program matching, and
          marketing decision support. We don&rsquo;t sell your data. We don&rsquo;t share it
          with insurers, lenders, buyers, or anyone else unless you explicitly tell us to.
          Satellite imagery of your fields comes from public archives; what we derive from it
          for your fields belongs to your workspace.
        </p>
      </LegalSection>

      <LegalSection title="What we collect">
        <p><strong>Account data:</strong> email address, optional name, hashed password if you set one, sign-in history (time, IP address, device description — shown to you at /account).</p>
        <p><strong>Operation data:</strong> farm name, state and counties, entity type, program-eligibility answers, and the fields you create — names, acreage, FSA farm/tract/field numbers, and boundary geometry if you provide it.</p>
        <p><strong>Evidence data:</strong> photos you upload (with their content hashes), satellite-derived observations of your fields, claim records and narratives you write, and confirmed outcomes you record (settlements, harvested yields).</p>
        <p><strong>Financial-position data:</strong> the marketing numbers you enter — production, sales, storage, costs, insurance floor, cash-flow needs. Entered by you, used only to compute the scenarios you see.</p>
        <p><strong>Technical data:</strong> server logs (requests, errors) with IP addresses, kept for operations and security. We run <strong>no third-party analytics or advertising trackers</strong>, and the only cookies we set are the strictly-necessary sign-in cookies — which is why there is no cookie banner: there is nothing to consent to beyond signing in.</p>
      </LegalSection>

      <LegalSection title="How we use it">
        <p>To provide the product: computing deadlines, building evidence packets, matching programs, running marketing scenarios, and analyzing imagery of your fields. To secure the service: rate limiting, abuse detection, audit logs. To improve the models — <strong>only in aggregate and only with your consent</strong>: confirmed outcomes (like a settlement figure) linked to imagery features are the training data that makes damage models possible; we will always ask before your operation&rsquo;s labeled outcomes join a training set, and the choice has no effect on the product you get.</p>
      </LegalSection>

      <LegalSection title="What we never do">
        <p>We do not sell personal or farm data. We do not share your identifiable data with insurers, lenders, grain buyers, input suppliers, or data brokers without your explicit direction (for example, you choosing to send a claim packet to your agent). We do not use your data to trade in commodity markets. We do not buy contact lists or track you across other websites.</p>
      </LegalSection>

      <LegalSection title="Who touches your data (processors)">
        <p>We host on Vercel (application), Turso (database), and Vercel Blob (uploaded imagery), with transactional email via Resend when configured. Each processes data only to run the service under their own security terms. Satellite scenes come from the public Copernicus Sentinel-2 archive (via AWS Open Data / Element84 Earth Search) and crop-type layers from USDA CropScape — requests to those services include your field&rsquo;s coordinates but never your identity.</p>
      </LegalSection>

      <LegalSection title="Location and boundary data">
        <p>Field boundaries and geotagged photos are precise location data about your land and are treated as sensitive: encrypted in transit, access-scoped to your workspace and its invited members, never shared or sold. Public satellite archives are, by nature, public — anyone can image any field — but the association between a boundary and your identity exists only in your workspace.</p>
      </LegalSection>

      <LegalSection title="Retention & deletion">
        <p>Your data stays while your account is active. Ask us to delete your operation and we will delete or de-identify it within 30 days, with one honest exception: append-only evidence and audit records that anchor a claim you already submitted are preserved as required for dispute integrity — deleting history is exactly what the evidence chain exists to prevent — but they are unlinked from your identity where deletion is requested.</p>
      </LegalSection>

      <LegalSection title="Your rights">
        <p>Regardless of which state you farm in, we honor access, correction, deletion, and portability requests: email us and you&rsquo;ll get your data out in a usable format. (As of this writing Illinois has no comprehensive consumer-privacy statute in force; several other states&rsquo; laws apply above user-count thresholds we haven&rsquo;t reached. We follow the common-denominator rights anyway, because they&rsquo;re right.)</p>
      </LegalSection>

      <LegalSection title="Financial-data note (GLBA)">
        <p>Neumeric provides decision-support and documentation tools; we do not currently believe this makes us a &ldquo;financial institution&rdquo; under the Gramm-Leach-Bliley Act. If our services change such that GLBA applies (for example, direct involvement in insurance transactions), we will meet its notice and safeguard requirements. <strong>This classification is one of the specific questions queued for attorney review.</strong></p>
      </LegalSection>

      <LegalSection title="Farm-data principles">
        <p>We intend to operate consistently with the Ag Data Transparent core principles: you own the data you provide, we get consent before collection, we tell you plainly how it&rsquo;s used, and you can take it with you when you leave.</p>
      </LegalSection>

      <LegalSection title="Changes & contact">
        <p>If this policy changes materially, account holders get an email before the change takes effect. Contact: idhantran@gmail.com.</p>
      </LegalSection>
    </LegalShell>
  );
}
