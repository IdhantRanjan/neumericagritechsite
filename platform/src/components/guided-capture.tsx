"use client";

/**
 * Guided claim-evidence capture — the "farmer in a field with a phone"
 * flow. Walks through what to photograph, captures GPS at shutter time
 * (device geolocation, with the farmer's permission), and submits photo +
 * coordinates together so the capture record is geotagged and timestamped.
 * Falls back gracefully when location is denied — the photo still counts,
 * the packet just says "no geotag".
 */
import { useRef, useState } from "react";
import { addEvidence } from "@/app/actions";

const SHOTS = [
  {
    label: "Wide shot",
    tip: "Stand at the field edge. Get the horizon and a landmark (road, bin, treeline) in frame so the location is recognizable.",
  },
  {
    label: "Mid-field",
    tip: "Walk 20–30 rows in. Show the damage pattern — lodged stalks, water line, hail bruising — across several rows.",
  },
  {
    label: "Close-up",
    tip: "One plant, close enough to see the mechanism: bruised stalks, shredded leaves, rot line. Hold a hand or hat in frame for scale.",
  },
  {
    label: "Worst spot",
    tip: "The most damaged area you can find. Adjusters average — make sure the worst is on record.",
  },
];

export function GuidedCapture({ claimId, disabled }: { claimId: string; disabled?: boolean }) {
  const [shot, setShot] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function locate(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
    if (!("geolocation" in navigator)) return null;
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  async function onFile(file: File | null) {
    if (!file || busy) return;
    setBusy(true);
    setMessage("Getting your location…");
    const loc = await locate();
    setMessage(loc ? "Uploading with geotag…" : "Uploading (no location — that's okay)…");
    const fd = new FormData();
    fd.set("photo", file);
    fd.set("shotLabel", SHOTS[shot].label);
    if (loc) {
      fd.set("lat", String(loc.lat));
      fd.set("lng", String(loc.lng));
      fd.set("accuracy", String(Math.round(loc.accuracy)));
    }
    try {
      await addEvidence(claimId, fd);
      setUploaded((u) => [...u, SHOTS[shot].label]);
      setShot((s) => Math.min(s + 1, SHOTS.length - 1));
      setMessage(loc ? "Saved with geotag ✓" : "Saved (no geotag) ✓");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Upload failed — try again.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (disabled) return null;

  return (
    <div className="card p-5 no-print space-y-4">
      <p className="label">Guided photo capture</p>
      <ol className="flex flex-wrap gap-2" aria-label="Shot checklist">
        {SHOTS.map((s, i) => (
          <li key={s.label}>
            <button
              type="button"
              onClick={() => setShot(i)}
              aria-current={i === shot ? "step" : undefined}
              className={`label !text-[11px] px-2.5 py-1 rounded-[60px] border transition-colors ${
                uploaded.includes(s.label)
                  ? "bg-[var(--forest-tint)] border-forest !text-forest-ink"
                  : i === shot
                    ? "border-forest !text-forest-ink"
                    : "border-ash"
              }`}
            >
              {uploaded.includes(s.label) ? "✓ " : `${i + 1}. `}
              {s.label}
            </button>
          </li>
        ))}
      </ol>
      <p className="text-[14px] text-ink-soft max-w-[420px]">{SHOTS[shot].tip}</p>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label={`Take the ${SHOTS[shot].label} photo`}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          disabled={busy}
          className="pill pill--solid pill--sm"
          onClick={() => fileRef.current?.click()}
        >
          {busy ? "Saving…" : `Take / choose ${SHOTS[shot].label.toLowerCase()}`}
        </button>
        {message && (
          <span className="text-[13px] text-ink-soft" role="status" aria-live="polite">
            {message}
          </span>
        )}
      </div>
      <p className="text-[12.5px] text-ink-soft">
        Photos are hashed (tamper-evidence) and geotagged at capture time when you allow
        location. Keep the originals on your phone too — they&rsquo;re yours.
      </p>
    </div>
  );
}
