import { NextRequest, NextResponse } from "next/server";
import { store } from "@nemocognition/db";
import { handleGetRun } from "../../handlers";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const result = handleGetRun(store, runId);
  return NextResponse.json(result.body, { status: result.status });
}
