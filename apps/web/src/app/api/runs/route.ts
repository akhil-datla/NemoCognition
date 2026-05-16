import { NextRequest, NextResponse } from "next/server";
import { store } from "@nemocognition/db";
import { handleCreateRun } from "../handlers";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const result = handleCreateRun(store, body);
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET() {
  const runs = store.getAllRuns();
  return NextResponse.json({ runs });
}
