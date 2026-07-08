"use client";

/**
 * Capture session (B1) — field ground-truth collection, mobile-first so a
 * founder can run it on a phone/tablet standing in the field. Flight params +
 * per-zone human damage estimates (frozen at capture). The drone ortho upload
 * and the objective-outcome recorder live alongside on the claim page; this
 * captures the structured human ground truth that links them into a
 * calibration-grade training example. See docs/CAPTURE-PROTOCOL.md.
 */
import { useState } from "react";
import { saveCaptureSession } from "@/app/actions";

type Session = {
  status: string;
  calibrationGrade: boolean;
  gsdCm: number | null;
  altitudeM: number | null;
  bands: string | null;
  groundControl: string | null;
  conditions: string | null;
  daysSinceEvent: number | null;
  growthStage: string | null;
  zoneEstimates: Array<{ zone: string; lossPct: number; acres: number }> | null;
} | null;

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  ground_truth: "Ground truth recorded",
  ortho: "Orthomosaic attached",
  calibration_grade: "Calibration-grade ✓",
};

export function CaptureSession({ claimId, session }: { claimId: string; session: Session }) {
  const initialZones = session?.zoneEstimates?.length
    ? session.zoneEstimates.map((_, i) => i)
    : [0];
  const [zones, setZones] = useState<number[]>(initialZones);

  return (
    <details className="card p-5 no-print" open={!session}>
      <summary className="cursor-pointer flex items-center justify-between gap-3">
        <span className="label">Capture session — field ground truth</span>
        <span className={`tag ${session?.calibrationGrade ? "tag--forest" : "tag--ash"}`}>
          {session ? STATUS_LABEL[session.status] ?? session.status : "Not started"}
        </span>
      </summary>

      <p className="text-[13px] text-ink-soft my-3 max-w-[440px]">
        Records the flight and your on-the-ground read of the damage. Freezes your zone
        estimates at capture time — the objective outcome (adjuster settlement or harvested
        yield, recorded below) is what later makes this a calibration-grade training example.
        Full protocol in the field guide.
      </p>

      <form action={saveCaptureSession.bind(null, claimId)} className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="label block mb-1">GSD (cm/px)</label>
            <input name="gsdCm" type="number" step="0.1" defaultValue={session?.gsdCm ?? ""} placeholder="2" />
          </div>
          <div>
            <label className="label block mb-1">Altitude (m)</label>
            <input name="altitudeM" type="number" step="1" defaultValue={session?.altitudeM ?? ""} placeholder="90" />
          </div>
          <div>
            <label className="label block mb-1">Bands</label>
            <select name="bands" defaultValue={session?.bands ?? "rgb"}>
              <option value="rgb">RGB</option>
              <option value="rgb_nir">RGB + NIR</option>
            </select>
          </div>
          <div>
            <label className="label block mb-1">Ground control</label>
            <select name="groundControl" defaultValue={session?.groundControl ?? "camera_gps"}>
              <option value="camera_gps">Camera GPS</option>
              <option value="gcp">Ground control points</option>
              <option value="rtk">RTK / PPK</option>
            </select>
          </div>
          <div>
            <label className="label block mb-1">Days since event</label>
            <input name="daysSinceEvent" type="number" step="1" defaultValue={session?.daysSinceEvent ?? ""} placeholder="1" />
          </div>
          <div>
            <label className="label block mb-1">Growth stage</label>
            <input name="growthStage" defaultValue={session?.growthStage ?? ""} placeholder="V10" />
          </div>
          <div className="col-span-2">
            <label className="label block mb-1">Conditions (light / wind)</label>
            <input name="conditions" defaultValue={session?.conditions ?? ""} placeholder="overcast, calm" />
          </div>
        </div>

        <div>
          <p className="label mb-2">Damage by zone (your honest estimate)</p>
          <div className="space-y-2">
            {zones.map((key, i) => {
              const z = session?.zoneEstimates?.[i];
              return (
                <div key={key} className="grid grid-cols-6 gap-2 items-end">
                  <div className="col-span-3">
                    <input name="zoneName" placeholder={`Zone ${i + 1} (e.g. NW corner)`} defaultValue={z?.zone ?? ""} />
                  </div>
                  <div className="col-span-2">
                    <input name="zoneLoss" type="number" min="0" max="100" placeholder="% loss" defaultValue={z?.lossPct ?? ""} />
                  </div>
                  <div>
                    <input name="zoneAcres" type="number" step="0.1" min="0" placeholder="ac" defaultValue={z?.acres ?? ""} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-2 mt-2">
            <button type="button" className="pill pill--sm pill--quiet" onClick={() => setZones((z) => [...z, (z.at(-1) ?? 0) + 1])}>
              + Zone
            </button>
            {zones.length > 1 && (
              <button type="button" className="pill pill--sm pill--quiet" onClick={() => setZones((z) => z.slice(0, -1))}>
                Remove
              </button>
            )}
          </div>
        </div>

        <button type="submit" className="pill pill--sm">Save capture session</button>
      </form>
    </details>
  );
}
