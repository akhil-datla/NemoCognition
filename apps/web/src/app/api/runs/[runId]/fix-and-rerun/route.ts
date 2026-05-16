import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store-factory";
import { handleFixAndRerun } from "../../../handlers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const store = await getStore();
  const { runId } = await params;
  const body = await request.json();
  const result = await handleFixAndRerun(store, runId, body);
  return NextResponse.json(result.body, { status: result.status });
}
