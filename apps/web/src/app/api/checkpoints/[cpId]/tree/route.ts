import { NextResponse } from "next/server";
import { getStore } from "@/lib/store-factory";
import { snapper } from "@/lib/snapper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/checkpoints/:cpId/tree
 *
 * Returns the file manifest of the snapshot referenced by checkpoint `cpId`.
 * Reads the on-disk manifest written next to the TAR archive — does not
 * untar.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cpId: string }> },
) {
  const { cpId } = await params;
  const store = await getStore();
  const cp = await store.getCheckpoint(cpId);
  if (!cp) return NextResponse.json({ error: "Checkpoint not found" }, { status: 404 });
  if (!cp.diffRef) {
    return NextResponse.json(
      { error: "Checkpoint has no filesystem snapshot" },
      { status: 404 },
    );
  }

  const manifest = await snapper.readManifest(cp.diffRef);
  if (!manifest) {
    return NextResponse.json(
      { error: "Snapshot manifest not found on disk", artifactPath: cp.diffRef },
      { status: 410 },
    );
  }

  return NextResponse.json({
    cpId: manifest.cpId,
    runId: manifest.runId,
    branchId: manifest.branchId,
    nodeId: manifest.nodeId,
    kind: manifest.kind,
    checksum: manifest.checksum,
    fileCount: manifest.fileCount,
    files: manifest.files,
    sandboxRoot: manifest.sandboxRoot,
    createdAt: manifest.createdAt,
  });
}
