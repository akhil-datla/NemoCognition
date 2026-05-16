import { NextRequest, NextResponse } from "next/server";
import { store } from "@nemocognition/db";
import { handleGetNode } from "../../../../handlers";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string; nodeId: string }> }
) {
  const { runId, nodeId } = await params;
  const result = handleGetNode(store, runId, nodeId);
  return NextResponse.json(result.body, { status: result.status });
}
