"use client";

/**
 * Satellite-scan control: kicks off the background job, polls its status,
 * and refreshes the page data when it finishes. The farmer sees what the
 * pipeline is doing ("Scanning 2026 season…"), not a frozen button.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { scanFieldAction } from "@/app/actions";

type JobView = { status: string; progress: string | null; error: string | null };

export function ScanButton({ fieldId, label }: { fieldId: string; label: string }) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!jobId) return;
    timer.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) return;
        const j: JobView = await res.json();
        setJob(j);
        if (j.status === "done" || j.status === "failed") {
          if (timer.current) clearInterval(timer.current);
          setJobId(null);
          if (j.status === "done") router.refresh();
        }
      } catch {
        // transient poll failure — keep polling
      }
    }, 2500);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [jobId, router]);

  const running = jobId !== null;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        disabled={running}
        className="pill pill--sm"
        onClick={async () => {
          setError(null);
          setJob(null);
          try {
            const { jobId: id } = await scanFieldAction(fieldId);
            setJobId(id);
            setJob({ status: "queued", progress: "Queued", error: null });
          } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't start the scan.");
          }
        }}
      >
        {running ? "Scanning…" : label}
      </button>
      {job && job.status !== "done" && (
        <span className="label !text-[10.5px]" role="status" aria-live="polite">
          {job.status === "failed" ? `Failed: ${job.error ?? "unknown error"}` : job.progress}
        </span>
      )}
      {job?.status === "done" && (
        <span className="label !text-[10.5px] !text-forest-ink" role="status">
          Scan complete
        </span>
      )}
      {error && (
        <span className="label !text-[10.5px] !text-[var(--red)]" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
