import { NextRequest, NextResponse } from "next/server";
import { store } from "@nemocognition/db";
import { handleCreateVideo } from "../../../handlers";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const result = handleCreateVideo(store, runId);
  return NextResponse.json(result.body, { status: result.status });
}
