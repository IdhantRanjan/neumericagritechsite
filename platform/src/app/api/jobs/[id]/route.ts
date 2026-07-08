/** Job status polling — scoped to the caller's operation. */
import { NextResponse } from "next/server";
import { currentAccess } from "@/lib/current-op";
import { getJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await currentAccess();
  if (!a) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const job = await getJob(id, a.op.id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    result: job.result,
  });
}
