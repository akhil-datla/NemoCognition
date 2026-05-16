import { NextRequest, NextResponse } from "next/server";
import { store } from "@nemocognition/db";
import { handleGetNodeState } from "../../../../../handlers";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string; nodeId: string }> }
) {
  const { runId, nodeId } = await params;
  const result = handleGetNodeState(store, runId, nodeId);
  return NextResponse.json(result.body, { status: result.status });
}
