# Neumeric — Product & Brand Context for Landing Page Build

This document is the full context for building the Neumeric landing page. Read it entirely before writing code — it contains the product thesis, positioning, target users, design direction, and content structure.

---

## 1. What Neumeric is (one-liner + expanded)

**One-liner:** A computer-vision-backed financial layer for farmers — the camera verifies what's happening on the ground, and it powers better insurance claims, automatic payouts, and smarter selling decisions.

**Expanded:** Neumeric uses computer vision (drone and camera imagery of crops and livestock) to establish objective "ground truth" about a farm's physical assets — crop health, damage, yield, animal condition — and then plugs that verified truth directly into the financial decisions farmers make around that asset: insurance claims, parametric payouts, and grain marketing/hedging. The camera is the sensor; the money product is what farmers actually pay for.

## 2. The core thesis

Farmers make big financial decisions — insurance claims, when to sell their crop, how to prove a loss — based on guesswork, paperwork, and phone calls, while the *insurance companies* and grain buyers on the other side of the table increasingly use AI, satellite imagery, and computer vision to make their own decisions. Neumeric flips that: it puts the same caliber of verified, image-based evidence to work *for the farmer*, not against them.

The unifying idea: **the camera establishes ground truth about a physical asset, and a financial product monetizes that truth.**

## 3. The three product pillars (same core CV tech, different financial applications)

1. **Insurance advocate (the wedge / v0).** Farmers must report acreage, document yield history, and file claims after damage (hail, flood, drought, disease). Today this is manual, error-prone, and farmers face a claims process where the insurer's adjuster works for the insurer, not them. Neumeric uses CV on drone/phone imagery to document damage objectively and helps farmers build a stronger, faster, harder-to-deny claim — plus catches government farm-program money (USDA/FSA payments) farmers often leave on the table due to paperwork complexity. Framed as "TurboTax for crop insurance" — everyone else builds this AI for the insurer; Neumeric builds it for the farmer. This is "found money" — it sells itself because the ROI is immediate and obvious to a farmer.
2. **Parametric insurance (expansion).** Traditional insurance pays out only after a human adjuster inspects damage — slow and disputable. Parametric insurance pays out automatically when a measurable, objective trigger is hit. Neumeric's CV system can *be* that trigger: e.g., a policy pays out automatically when drone imagery confirms stand loss past a threshold, or when hive/herd/field cameras confirm a defined loss event. No adjuster, no dispute, no claim paperwork — the vision system is both the underwriting data and the payout trigger.
3. **Hedging / grain marketing copilot (expansion).** Farmers must decide when and how much of their crop to sell across an ~18-month window, juggling futures price, local basis, storage cost, cash-flow needs, and their crop-insurance floor — today mostly done on gut feel, which leads to panic-selling and missed value. Neumeric's CV-verified yield and crop-condition data feeds a marketing copilot that shows the farmer their real position (not a guess) and helps them sell with discipline instead of emotion. Important: this product does NOT predict prices (that's both impossible and legally/ethically risky) — it brings clarity, scenario modeling, and behavioral discipline to a decision the farmer already has to make.

**Sequencing:** Pillar 1 (insurance advocate) is the fastest to build, fastest to prove value, and doesn't require financial licensing to start (it's decision-support, not tailored trading advice). Pillars 2 and 3 are the expansion once trust and data are established — Pillar 3 in particular has a regulatory line (CFTC/NFA Commodity Trading Advisor rules) that requires either staying on the "informational, non-tailored" side or eventually registering, which is a deliberate long-term moat, not just a constraint.

## 4. Why this is defensible (the "moat" story, useful for messaging tone)

- **Proprietary data flywheel:** every field/herd imaged makes the CV models better, and that data compounds over time in a way competitors can't easily replicate.
- **Owns both the measurement AND the transaction:** most ag-CV companies just sell "detection" (a bounding box, a defect flag). Neumeric owns the full loop from image → verified truth → financial outcome (a paid claim, a payout, a sell decision) — which is what farmers actually pay for and what makes the product sticky.
- **Regulatory moat:** the insurance and advisory space has real compliance requirements that most software-only competitors won't bother clearing — which is exactly why clearing them (in later phases) becomes a durable barrier to entry.

## 5. Who the product is for (audience for the landing page)

Primary: **row-crop and diversified farmers** (corn, soybean, specialty crops) in the US Midwest, roughly 100–5,000+ acres, who currently deal with crop insurance paperwork, USDA program filings, and grain marketing decisions largely on their own or through a local agent/co-op.

Secondary (future phases / partners, worth acknowledging in messaging but not the primary CTA): crop insurance agents, ag lenders (e.g., Farm Credit/Compeer-style institutions who want their borrowers marketing well), grain elevators/co-ops.

**Important tone note:** this audience is not a typical "startup landing page" audience. Farmers are practical, skeptical of hype, deeply value-driven, and immediately turned off by generic tech jargon ("revolutionary," "AI-powered," "disrupting"), sci-fi imagery, or a cold enterprise-SaaS feel. The site needs to feel warm, grounded, plain-spoken, and trustworthy — like something built *by* people who understand farming, not sold *at* farmers by Silicon Valley.

## 6. Visual / design direction

**Overall aesthetic reference points:** think Bushel (bushelpowered.com) and Halter (halterhq.com) — warm, golden-hour photography of real farmland, crops, and livestock; approachable and human-scale rather than moody/industrial/sci-fi (avoid the Monarch Tractor/Carbon Robotics dark, robotic aesthetic — that's for hardware companies selling machines; Neumeric sells trust and clarity, not robots).

**Landing page style reference (this build):** General Intelligence Company (generalintelligencecompany.com) — an editorial, publication-like feel: warm off-white canvas, near-black serif display headlines, compact sans body, a single restrained blue accent used only for inline links, a floating dark pill navigation island, frosted-glass text cards floating over full-bleed illustrated scenes, hairline borders and soft shadows. Full design tokens are stored in `design-tokens.md`. The illustration language here is rendered as hand-crafted pixel/8-bit farm scenes (sunset field, combine, cattle, night sky) with subtle motion, plus scroll-pinned "scrollytelling" animation for the How-it-works sequence.

**Specific direction:**
- **Hero section:** full-bleed farmland scene — golden-hour lighting, a combine at sunset, a healthy field. NOT stock-photo-green, NOT sci-fi drone-HUD overlays as the primary image. The land carries the emotional weight; the tech stays quiet.
- **Palette:** muted earth tones (warm browns, wheat gold, soft sky blue) plus a grounded green as the accent. Avoid neon/tech greens and cold enterprise blues/grays.
- **Typography:** confident humanist sans for body, editorial serif for display headlines — large, plain-spoken copy.
- **Layout:** generous negative space, full-bleed illustrated sections alternating with clean editorial content sections.
- **Overall feeling:** trustworthy, grounded, quietly confident, human.

## 7. Tone of voice for copy

- Plain-spoken, direct, no jargon. Say "we help you get paid faster on a claim" not "we leverage AI to optimize claims adjudication workflows."
- Lead with the farmer's actual pain and the concrete outcome (money, time, certainty), not the technology.
- Confident but not hype-y — avoid "revolutionary," "disrupt," "game-changing," "cutting-edge."
- Short sentences. Should read like something a smart, direct person would say to a farmer across a truck tailgate.

## 8. Page structure / sections

1. **Hero** — full-bleed farmland scene, plain benefit-first headline, short supporting line, single clear CTA (early access / talk to us — pre-launch stage).
2. **The problem** — honest section on insurance paperwork, adjusters who don't work for you, guessing when to sell. Simple "today vs. with Neumeric" contrast.
3. **How it works** — simple 3-step: (1) camera/drone captures field or herd → (2) Neumeric verifies what's actually happening → (3) verified truth powers a stronger claim, an automatic payout, or a clearer sell decision.
4. **The three pillars** — insurance advocate (now) / parametric payouts (next) / marketing copilot (next). Honest that it's early-stage.
5. **Why it's different** — "AI built for insurance companies" vs. Neumeric built for the farmer. Short and pointed.
6. **Manifesto** — a philosophical, editorial long-form statement of the company's ideology (accessible from the nav).
7. **Trust / credibility** — founder building in public, currently validating with Midwest farmers. No fake logos/testimonials/metrics.
8. **CTA / early access** — simple form: name, email, farm type/size, optional note. "We're talking to farmers right now — want to be one of the first?"
9. **Footer** — simple, minimal.

## 9. Things to explicitly avoid

- Sci-fi/robotic visual language (drone HUD overlays, dark tech aesthetics, neon accents).
- Generic AI-startup copy ("AI-powered," "revolutionary," "next-generation").
- Fake social proof, logos, testimonials, or invented metrics/stats — this is pre-validation-stage and must stay honest.
- Overly busy UI mockups.
- Cold, corporate enterprise-SaaS feel.

## 10. Domain / naming context

Domain: **neumeric.xyz** (already owned). Name is final.

## 11. Technical build notes

Marketing/landing page, not the product app — a single well-crafted scrolling page. Responsive, excellent on mobile (farmers view on phone). Optimized imagery. No backend beyond a simple email-capture form for early access.
