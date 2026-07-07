import type { ReactNode } from "react";
import type { GeoJSONPolygon } from "@/db/schema";

export function PageHeader({
  eyebrow,
  title,
  accent,
  lede,
  actions,
}: {
  eyebrow: string;
  title: string;
  accent?: string; // one italic forest word inside the headline (signature move)
  lede?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="pt-10 sm:pt-14 pb-8 flex flex-wrap items-end justify-between gap-6">
      <div>
        <p className="label mb-3">{eyebrow}</p>
        <h1 className="text-[2rem] sm:text-[2.75rem]">
          {title}
          {accent ? (
            <>
              {" "}
              <em className="text-forest">{accent}</em>
            </>
          ) : null}
        </h1>
        {lede ? (
          <p className="mt-3 max-w-[620px] text-ink-soft font-light text-[17px]">{lede}</p>
        ) : null}
      </div>
      {actions ? <div className="flex gap-3 no-print">{actions}</div> : null}
    </header>
  );
}

export function Meta({ k, v, sub }: { k: string; v: ReactNode; sub?: string }) {
  return (
    <div>
      <p className="label mb-1">{k}</p>
      <p className="meta-value">{v}</p>
      {sub ? <p className="text-[13px] text-ink-soft mt-0.5">{sub}</p> : null}
    </div>
  );
}

const TAG_TONES: Record<string, string> = {
  upcoming: "tag--forest",
  done: "tag--ash",
  missed: "tag--red",
  urgent: "tag--amber",
  strong: "tag--forest",
  likely: "tag--amber",
  possible: "tag--ash",
  draft: "tag--ash",
  evidence: "tag--amber",
  packet_ready: "tag--forest",
  submitted: "tag--forest",
  healthy: "tag--forest",
  stressed: "tag--amber",
  damaged: "tag--red",
  destroyed: "tag--red",
  demo: "tag--amber",
};

export function Tag({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`tag ${TAG_TONES[tone] ?? "tag--ash"}`}>{children}</span>;
}

export function DemoTag() {
  return <Tag tone="demo">Sample</Tag>;
}

/** Flat forest line-art rendering of a field boundary (GeoJSON → SVG). */
export function FieldShape({
  boundary,
  className = "",
}: {
  boundary: GeoJSONPolygon | null;
  className?: string;
}) {
  if (!boundary) {
    return <div className={`bg-[var(--forest-tint)] rounded ${className}`} />;
  }
  const ring = boundary.coordinates[0];
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX || 1, h = maxY - minY || 1;
  const pad = 8, size = 100;
  const pts = ring
    .map((p) => {
      const x = pad + ((p[0] - minX) / w) * (size - 2 * pad);
      const y = pad + ((maxY - p[1]) / h) * (size - 2 * pad); // flip lat axis
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <polygon
        points={pts}
        fill="var(--forest-tint)"
        stroke="var(--forest)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
