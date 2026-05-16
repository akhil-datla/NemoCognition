import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store-factory";
import { handleCreateRun } from "../handlers";

export async function POST(request: NextRequest) {
  const store = await getStore();
  const body = await request.json();
  const result = await handleCreateRun(store, body);
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET() {
  const store = await getStore();
  const runs = await store.getAllRuns();
  return NextResponse.json({ runs });
}
