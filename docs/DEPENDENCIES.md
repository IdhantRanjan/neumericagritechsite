# Neumeric — Legal, Compliance & Partnership Dependencies

The blocking list: each item names **what it blocks**, **who to talk to**, and **what software work can continue anyway**. Nothing here is legal advice — every ⚖️ item needs an actual lawyer before real users touch the feature.

---

## Blocking Pillar 1 (insurance advocate)

### 1. ⚖️ Claims-assistance boundary review — *low risk, verify early*
- **Issue:** Pillar 1 is decision-support and documentation ("here is organized evidence and your own data"), which should not require insurance producer/adjuster licensing. But some states regulate "public adjusters" (people who negotiate claims on an insured's behalf, for a fee) — packet language and pricing (especially any success-fee tied to claim value) must stay on the documentation side of that line, and the line moves state by state.
- **Blocks:** success-fee pricing model; any feature that *negotiates* with the insurer rather than *documents* for the farmer.
- **Doesn't block:** the entire evidence builder, deadline tracker, and program finder as built.
- **Who:** insurance regulatory counsel (one consult, IL first); sanity-check with a friendly crop-insurance agent.

### 2. 🤝 Adjuster/agent validation of the evidence packet format
- **Blocks:** calling the packet "insurer-legible" in marketing; Phase 1 exit.
- **Who:** a crop insurance agent + ideally a former AIP adjuster from the IL network.

### 3. 🤝 Imagery licensing (only if/when Sentinel-2 isn't enough)
- Sentinel-2 is free/open (ESA). Planet/Airbus-class tasking needs a commercial license and real budget. **Blocks:** sub-10m satellite evidence. **Doesn't block:** phone/drone imagery (farmer-owned) or Sentinel-based analysis.

### 4. ⚖️ Farm data privacy posture
- No single US farm-data statute, but lender distribution will trigger GLBA-adjacent scrutiny, and Ag Data Transparency-style commitments matter for farmer trust. Deletion-vs-audit-trail tension (claim evidence can't silently vanish) needs a documented policy. **Blocks:** lender pilot contracts. **Who:** same counsel, plus review the AgGateway/ADT core principles.

## Blocking Pillar 2 (parametric)

### 5. 🤝⚖️ **Licensed carrier/reinsurer partner — the hard gate**
- Neumeric cannot underwrite, price, or pay claims. Full stop. The parametric product exists only as *CV trigger infrastructure sold to* a carrier/reinsurer (or an MGA arrangement under one).
- **Blocks:** any real policy, any real payout, any premium math in the codebase.
- **Doesn't block:** trigger engine, evaluation trace, carrier API — all buildable as spec/demo now.
- **Who:** innovation teams at reinsurers (Swiss Re/Munich Re-style), parametric-friendly MGAs, or a specialty crop AIP.

### 6. ⚖️ Trigger methodology as a contractual instrument
- The trigger definition (metric, threshold, cadence, imagery source, failure/no-data handling) must be co-signed and versioned with the carrier — it's a contract term, not a config value. **Who:** carrier counsel + ours, once #5 exists.

## Blocking Pillar 3 (marketing copilot)

### 7. ⚖️ **CTA exemption review — before launch, not after**
- Commodity Exchange Act: advising on futures/options for compensation = Commodity Trading Advisor, registration required (CFTC/NFA, Series 3) **unless** the advice is not tailored to a specific customer's account. The v0 is architected to stay inside that exemption: farmer's own data reflected back, parameter-sweep scenarios of *farmer-chosen* actions, alerts on *farmer-set* targets; no "you should sell X now," no execution.
- **Blocks:** Pillar 3 launch to real users; any wording anywhere (UI, marketing, emails) that reads as a tailored directive.
- **Doesn't block:** building the dashboard/scenario/plan features to spec now.
- **Who:** CFTC/NFA-experienced counsel. Also confirm whether the *lender-distributes-it* model changes the analysis.
- **Never without registration + FCM/IB relationships:** trade execution, order routing, brokerage of any kind.

### 8. 🤝 Market data feeds
- Futures quotes (CME data licensing) and local basis (elevator bids — via Bushel-style integrations, DTN license, or manual entry v0). **Blocks:** live-price features; **doesn't block:** the position/plan/scenario mechanics using farmer-entered prices.

## Cross-cutting

### 9. 🤝 Ag lender distribution partner (Phase 2)
- Best GTM channel; needs #4 resolved and a real Pillar-1 result to show. **Who:** Farm Credit system institutions (Compeer-style) via the founder's IL network.

### 10. ⚖️ Success-fee / contingency pricing review
- "We only make money when you get money" is powerful but interacts with #1 (public-adjuster rules) and possibly state fee-sharing rules for program payments. Get it reviewed before any farmer signs one.

---

**Summary for the founder:** nothing blocks continued software work on Pillar 1 and the demo builds of Pillars 2–3. The human conversations to start now, in order: (1) friendly agent/adjuster on packet format, (2) one insurance-regulatory counsel consult covering #1/#4/#10, (3) carrier/reinsurer intro pipeline for Pillar 2, (4) CFTC/NFA counsel lined up for when Pillar 3 approaches launch.
