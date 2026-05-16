import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store-factory";
import { handleGetRunPolicy } from "../../../handlers";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const store = await getStore();
  const { runId } = await params;
  const result = await handleGetRunPolicy(store, runId);
  return NextResponse.json(result.body, { status: result.status });
}
