import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store-factory";
import { handleCreateVideo } from "../../../handlers";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const store = await getStore();
  const { runId } = await params;
  const result = await handleCreateVideo(store, runId);
  return NextResponse.json(result.body, { status: result.status });
}
