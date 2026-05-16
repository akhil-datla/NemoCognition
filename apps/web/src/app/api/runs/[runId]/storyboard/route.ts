import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store-factory";
import { traceToStoryboard } from "@nemocognition/video";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const store = await getStore();
  const { runId } = await params;
  const run = await store.getRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const nodes = await store.getRunNodes(runId);
  const storyboard = traceToStoryboard(nodes, { runId, title: run.title });
  return NextResponse.json(storyboard, { status: 200 });
}
