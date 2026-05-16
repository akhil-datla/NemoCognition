import { NextResponse } from "next/server";
import { getStore, getStoreKind } from "@/lib/store-factory";

export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  const store = await getStore();
  let storeOk = false;
  try {
    storeOk = await store.ping();
  } catch {
    storeOk = false;
  }
  const ok = storeOk;
  return NextResponse.json(
    {
      ok,
      checks: { store: storeOk },
      storeKind: getStoreKind(),
      durationMs: Date.now() - start,
      version: process.env.npm_package_version ?? "0.1.0",
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
