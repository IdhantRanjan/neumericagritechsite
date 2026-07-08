/**
 * Background jobs for slow work (satellite scans & analyses). On Vercel the
 * job body runs in `after()` — post-response compute on the same invocation,
 * up to the function's max duration — so nothing blocks the farmer's click.
 * Status lives in the jobs table; the UI polls /api/jobs/[id].
 *
 * Honest limitation (docs/DEPLOY.md): after() shares the invocation's time
 * budget (maxDuration 300s here). Scans are already budgeted (~20 scenes per
 * run) to fit; a dedicated queue (QStash/Inngest) is the documented upgrade
 * path if job sizes grow.
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, tables as t } from "@/db";
import { log } from "@/lib/log";
import type { Job } from "@/db/schema";

const now = () => new Date().toISOString();

export async function createJob(
  operationId: string,
  kind: string,
  entityId: string
): Promise<Job> {
  const db = await getDb();
  const job = {
    id: `job_${randomBytes(6).toString("hex")}`,
    operationId,
    kind,
    entityId,
    status: "queued",
    progress: "Queued",
    result: null,
    error: null,
    createdAt: now(),
    startedAt: null,
    finishedAt: null,
  };
  await db.insert(t.jobs).values(job);
  return job as Job;
}

export async function setJobProgress(jobId: string, progress: string) {
  const db = await getDb();
  await db.update(t.jobs).set({ progress }).where(eq(t.jobs.id, jobId));
}

/** Run a job body with status transitions + error capture. */
export async function runJob(
  jobId: string,
  body: (setProgress: (p: string) => Promise<void>) => Promise<Record<string, unknown>>
) {
  const db = await getDb();
  await db
    .update(t.jobs)
    .set({ status: "running", startedAt: now(), progress: "Starting" })
    .where(eq(t.jobs.id, jobId));
  try {
    const result = await body((p) => setJobProgress(jobId, p));
    await db
      .update(t.jobs)
      .set({ status: "done", finishedAt: now(), result, progress: "Done" })
      .where(eq(t.jobs.id, jobId));
    log.info("job.done", { jobId });
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 500) : String(e);
    await db
      .update(t.jobs)
      .set({ status: "failed", finishedAt: now(), error: msg, progress: "Failed" })
      .where(eq(t.jobs.id, jobId));
    log.error("job.failed", { jobId, error: msg });
  }
}

export async function getJob(jobId: string, operationId: string): Promise<Job | null> {
  const db = await getDb();
  const job = (await db.select().from(t.jobs).where(eq(t.jobs.id, jobId)))[0];
  return job && job.operationId === operationId ? job : null;
}
