import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store-factory";
import { handleGetNodeState } from "../../../../../handlers";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string; nodeId: string }> }
) {
  const store = await getStore();
  const { runId, nodeId } = await params;
  const result = await handleGetNodeState(store, runId, nodeId);
  return NextResponse.json(result.body, { status: result.status });
}
