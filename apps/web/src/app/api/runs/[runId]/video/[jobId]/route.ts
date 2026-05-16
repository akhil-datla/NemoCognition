import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store-factory";
import { handleGetVideoJob } from "../../../../handlers";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string; jobId: string }> }
) {
  const store = await getStore();
  const { runId, jobId } = await params;
  const result = await handleGetVideoJob(store, runId, jobId);
  return NextResponse.json(result.body, { status: result.status });
}
