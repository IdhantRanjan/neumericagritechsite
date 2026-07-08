"use client";

/**
 * Guided product tour — click-to-advance walkthrough on a fictional but
 * realistic Illinois farm (Prairie Creek Farms, matching the demo seed).
 * Each step is a faithful mini-rendering of a real product surface with a
 * plain-language caption. All data is badged sample; no real customer.
 * Honors prefers-reduced-motion; works at truck-cab width.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Meta, Tag, FieldShape } from "@/components/ui";

type GeoPoly = { type: "Polygon"; coordinates: number[][][] };
const demoBoundary: GeoPoly = {
  type: "Polygon",
  coordinates: [[[-88.75, 41.905], [-88.734, 41.905], [-88.734, 41.919], [-88.75, 41.919], [-88.75, 41.905]]],
};

const STEPS = [
  {
    key: "overview",
    eyebrow: "Your dashboard",
    title: "Everything that needs you, in one place",
    caption:
      "Open the app and the whole operation is in front of you — the next insurance deadline, any open claims, program money you might be owed, and where your crop marketing stands. No digging.",
    render: () => (
      <div className="space-y-4">
        <div className="card grid grid-cols-2 lg:grid-cols-4 gap-4 p-5">
          <Meta k="Land" v="3 fields" sub="345 acres" />
          <Meta k="Next deadline" v="Jul 15" sub="Acreage report · 7 days" />
          <Meta k="Open claims" v="1" sub="1 with verified evidence" />
          <Meta k="Corn priced" v="25%" sub="breakeven $3.95" />
        </div>
        <div className="card divide-y divide-ash">
          <div className="p-4 flex items-center gap-3">
            <Tag tone="urgent">7 days</Tag>
            <span className="text-[14px]">Acreage reporting deadline — RMA + FSA</span>
          </div>
          <div className="p-4 flex items-center gap-3">
            <Tag tone="evidence">evidence</Tag>
            <span className="text-[14px]">Hail claim on Home 80 — 1 verified record</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    key: "field",
    eyebrow: "A field, watched from space",
    title: "Free satellite keeps an eye on every acre",
    caption:
      "Each field carries its boundary and a continuous satellite record — the green line is this field's NDVI, its living vital sign. Neumeric watches it against the field's own history, for free, all season. This is the always-on monitoring layer.",
    render: () => (
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <p className="serif text-[1.4rem]">Home 80</p>
            <p className="text-[13px] text-ink-soft">DeKalb County · 78 acres · corn 2026</p>
          </div>
          <FieldShape boundary={demoBoundary} className="w-16 h-16 shrink-0" />
        </div>
        <svg viewBox="0 0 320 90" className="w-full" aria-label="NDVI trend">
          {[0.3, 0.5, 0.7].map((g) => (
            <line key={g} x1="6" x2="314" y1={90 - g * 90} y2={90 - g * 90} stroke="var(--ash)" />
          ))}
          <path
            d="M6,58 L50,44 L94,32 L138,28 L182,30 L226,26 L270,40 L314,34"
            fill="none"
            stroke="var(--forest)"
            strokeWidth="2"
            className="tour-line"
          />
        </svg>
        <p className="label mt-2">Sentinel-2 · 10 m · every ~5 days</p>
      </div>
    ),
  },
  {
    key: "deadlines",
    eyebrow: "Never miss a date",
    title: "The insurance calendar, handled",
    caption:
      "Crop insurance runs on hard USDA deadlines — miss one and coverage or money slips away. Neumeric tracks every relevant date for your crops and state, and tells you what each one means.",
    render: () => (
      <div className="card divide-y divide-ash">
        {[
          ["Sales closing", "Mar 15", "done"],
          ["Final plant — corn", "Jun 5", "done"],
          ["Acreage reporting", "Jul 15", "urgent"],
          ["Production reporting", "Apr 29", "upcoming"],
        ].map(([t, d, tone]) => (
          <div key={t} className="p-4 flex items-center justify-between gap-3">
            <span className="text-[14px] font-medium">{t}</span>
            <span className="flex items-center gap-3">
              <span className="font-mono text-[13px]">{d}</span>
              <Tag tone={tone as string}>{tone === "done" ? "done" : tone === "urgent" ? "7 days" : "upcoming"}</Tag>
            </span>
          </div>
        ))}
      </div>
    ),
  },
  {
    key: "claim",
    eyebrow: "When damage happens",
    title: "A claim built to be hard to deny",
    caption:
      "After a storm, Neumeric assembles a geotagged, timestamped evidence packet — satellite change-detection for drought, your drone or phone photos for hail and flood — with the imagery, the math, and a tamper-evident hash chain behind every number. You hand the adjuster proof, not a story.",
    render: () => (
      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-3">
          <Tag tone="damaged">hail</Tag>
          <span className="text-[14px] font-medium">Home 80 · June 28</span>
          <Tag tone="packet_ready">packet ready</Tag>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Meta k="Severity" v="54%" />
          <Meta k="Affected" v="46 ac" sub="of 78" />
          <Meta k="Method" v="drone" sub="1–3 cm/px" />
        </div>
        <p className="text-[12.5px] text-ink-soft border-t border-ash pt-3">
          Evidence chain verified · sha256 8fb6a5e2… · imagery + method version on file
        </p>
      </div>
    ),
  },
  {
    key: "programs",
    eyebrow: "Found money",
    title: "Government programs you actually qualify for",
    caption:
      "Farmers leave real money on the table because the paperwork is a maze. Neumeric cross-references your operation against USDA and NRCS programs and shows exactly why you match — and what's still needed.",
    render: () => (
      <div className="card divide-y divide-ash">
        {[
          ["ARC/PLC price support", "strong", "$0–60/base acre"],
          ["EQIP cover-crop cost share", "likely", "$30–60/acre"],
          ["Emergency disaster relief", "possible", "documented loss pays"],
        ].map(([n, s, v]) => (
          <div key={n} className="p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[14px] font-medium">{n}</p>
              <p className="text-[12.5px] text-ink-soft">{v}</p>
            </div>
            <Tag tone={s as string}>{s}</Tag>
          </div>
        ))}
      </div>
    ),
  },
  {
    key: "marketing",
    eyebrow: "Sell with a plan",
    title: "Your real position, and the range of outcomes",
    caption:
      "Not a price prediction — nobody can honestly do that. Neumeric shows your real position against breakeven, basis, storage cost, and your insurance floor, then simulates thousands of price paths so you see the range each selling choice could land in. You decide; the math is yours.",
    render: () => (
      <div className="card p-5">
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Meta k="Priced" v="25%" sub="3,000 of 12k bu" />
          <Meta k="Breakeven" v="$3.95" />
          <Meta k="Basis" v="−0.25" sub="normal" />
        </div>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-ash label">
              <th className="text-left py-1">If you…</th>
              <th className="text-right">P10</th>
              <th className="text-right">P50</th>
              <th className="text-right">P90</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {[
              ["Sell half now, hold half", "$44k", "$51k", "$58k"],
              ["Hold everything 6 months", "$39k", "$52k", "$66k"],
            ].map(([a, p10, p50, p90]) => (
              <tr key={a} className="border-b border-ash last:border-0">
                <td className="py-2 font-sans">{a}</td>
                <td className="text-right text-[var(--red)]">{p10}</td>
                <td className="text-right">{p50}</td>
                <td className="text-right text-forest-ink">{p90}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  },
] as const;

export function DemoTour() {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const atEnd = i === STEPS.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setI((p) => Math.min(STEPS.length - 1, p + 1));
      if (e.key === "ArrowLeft") setI((p) => Math.max(0, p - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="max-w-[820px] mx-auto pt-8 sm:pt-12 pb-24">
      <div className="flex items-center justify-between mb-6">
        <p className="label">Guided tour · Prairie Creek Farms <span className="tag tag--amber ml-2">Sample farm</span></p>
        <Link href="/join/demo" className="label hover:text-forest">Skip into the app →</Link>
      </div>

      {/* progress segments */}
      <div className="flex gap-1.5 mb-8">
        {STEPS.map((s, idx) => (
          <button
            key={s.key}
            onClick={() => setI(idx)}
            aria-label={`Go to step ${idx + 1}`}
            className={`h-1 flex-1 rounded-full transition-colors ${idx <= i ? "bg-forest" : "bg-ash"}`}
          />
        ))}
      </div>

      <div key={step.key} className="tour-slide">
        <p className="label mb-2">{step.eyebrow}</p>
        <h1 className="serif text-[1.9rem] sm:text-[2.4rem] leading-tight mb-4">{step.title}</h1>
        <p className="text-ink-soft text-[16px] leading-relaxed max-w-[640px] mb-7">{step.caption}</p>
        <div className="tour-viz">{step.render()}</div>
      </div>

      <div className="flex items-center justify-between mt-9">
        <button
          onClick={() => setI((p) => Math.max(0, p - 1))}
          disabled={i === 0}
          className="pill pill--quiet disabled:opacity-30"
        >
          ← Back
        </button>
        <span className="label">{i + 1} / {STEPS.length}</span>
        {atEnd ? (
          <Link href="/join/demo" className="pill pill--solid">Explore the live demo →</Link>
        ) : (
          <button onClick={() => setI((p) => p + 1)} className="pill pill--solid">Next →</button>
        )}
      </div>

      <style>{`
        .tour-slide { animation: tourIn .45s cubic-bezier(.22,.61,.36,1); }
        .tour-line { stroke-dasharray: 400; stroke-dashoffset: 400; animation: tourDraw 1.1s ease forwards .15s; }
        @keyframes tourIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        @keyframes tourDraw { to { stroke-dashoffset: 0; } }
        @media (prefers-reduced-motion: reduce) {
          .tour-slide { animation: none; }
          .tour-line { animation: none; stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}
