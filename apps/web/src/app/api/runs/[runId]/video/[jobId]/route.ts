import { NextRequest, NextResponse } from "next/server";
import { store } from "@nemocognition/db";
import { handleGetVideoJob } from "../../../../handlers";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string; jobId: string }> }
) {
  const { runId, jobId } = await params;
  const result = handleGetVideoJob(store, runId, jobId);
  return NextResponse.json(result.body, { status: result.status });
}
