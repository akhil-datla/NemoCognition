import { NextResponse } from "next/server";
import { getStore } from "@/lib/store-factory";
import { snapper } from "@/lib/snapper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 200 * 1024;

/**
 * GET /api/checkpoints/:cpId/file?path=<entry>
 *
 * Returns the bytes of a single file from the snapshot. UTF-8 only and
 * truncated at 200KB to keep the inspector responsive.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ cpId: string }> },
) {
  const { cpId } = await params;
  const url = new URL(req.url);
  const entry = url.searchParams.get("path");
  if (!entry) {
    return NextResponse.json({ error: "Missing ?path=" }, { status: 400 });
  }

  const store = await getStore();
  const cp = await store.getCheckpoint(cpId);
  if (!cp) return NextResponse.json({ error: "Checkpoint not found" }, { status: 404 });
  if (!cp.diffRef) {
    return NextResponse.json(
      { error: "Checkpoint has no filesystem snapshot" },
      { status: 404 },
    );
  }

  const buf = await snapper.readEntry(cp.diffRef, entry);
  if (!buf) {
    return NextResponse.json({ error: `Entry not in snapshot: ${entry}` }, { status: 404 });
  }

  const truncated = buf.length > MAX_BYTES;
  const slice = truncated ? buf.subarray(0, MAX_BYTES) : buf;

  return NextResponse.json({
    path: entry,
    bytes: buf.length,
    truncated,
    content: slice.toString("utf8"),
  });
}
