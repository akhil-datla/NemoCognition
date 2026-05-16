import { NextRequest, NextResponse } from "next/server";
import { store } from "@nemocognition/db";
import { handleGetGraph } from "../../../handlers";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const result = handleGetGraph(store, runId);
  return NextResponse.json(result.body, { status: result.status });
}
