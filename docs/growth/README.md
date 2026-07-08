# Growth pipeline — rules of the road

Everything in this directory is a **draft**. Nothing here is sent, posted, or
published by software. The gates, in order:

1. **A human (Ranjan) reads and edits the draft.** The voice rules apply:
   plain-spoken, no hype words ("revolutionary", "AI-powered", "game-changing"
   are banned), no fabricated numbers, no invented testimonials — if we don't
   have a real customer quote, we don't use a quote.
2. **Compliance check before any send:**
   - Email: CAN-SPAM — real sender identity, working one-click unsubscribe,
     physical mailing address in the footer, subject lines that aren't
     deceptive. Recipients must have opted in (waitlist double-opt-in) or be
     an individually-addressed 1:1 business email.
   - Texting/calls: TCPA — no automated texts/calls without prior express
     consent. Founder 1:1 texts to people who gave their number are fine.
   - Platforms: follow each platform's ToS. No automation of DMs, likes,
     or follows. No astroturfing, no fake accounts, ever.
3. **Send tooling:** onboarding/drip sequences run through a proper ESP
   (Resend broadcast or similar) with suppression-list handling — never a
   script looping over the users table.

## What's here

- `content/` — educational drafts for the blog/social queue (genuinely
  useful farm-finance explainers; the product sells itself when the
  education is real).
- `emails/` — the onboarding sequence for confirmed waitlist signups.
- `lender-onepager.md` — the ag-lender outreach kit (the strongest GTM
  channel: borrower risk management is loan-book risk management).

## Funnel instrumentation (live in-product)

- Waitlist channel attribution (`direct` / `lender` / `agent` / `coop`) is
  captured at signup, double-opt-in confirmed, and linked to onboarding when
  the same email creates a farm — the /growth dashboard reads the funnel
  straight from the database. The strategic question it answers: which
  channel converts to onboarded farms, not which channel produces signups.
