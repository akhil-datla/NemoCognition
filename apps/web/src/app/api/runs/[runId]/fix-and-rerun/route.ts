import { NextRequest, NextResponse } from "next/server";
import { store } from "@nemocognition/db";
import { handleFixAndRerun } from "../../../handlers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const body = await request.json();
  const result = handleFixAndRerun(store, runId, body);
  return NextResponse.json(result.body, { status: result.status });
}
