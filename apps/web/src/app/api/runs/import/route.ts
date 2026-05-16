import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store-factory";
import { handleImportRun } from "../../handlers";

export async function POST(request: NextRequest) {
  const store = await getStore();
  const body = await request.json();
  const result = await handleImportRun(store, body);
  return NextResponse.json(result.body, { status: result.status });
}
