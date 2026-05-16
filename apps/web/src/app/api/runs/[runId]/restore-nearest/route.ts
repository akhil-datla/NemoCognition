import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store-factory";
import { restoreSnapshot } from "@/lib/snapshot";
import { getSandboxRoot, defaultSandboxRoot } from "@/lib/sandbox-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const inputSchema = z.object({
  beforeNodeId: z.string().min(1),
  branchId: z.string().min(1),
});

/**
 * Find the nearest checkpoint before `beforeNodeId` on `branchId` and restore
 * the filesystem from its snapshot. One-shot helper for the Recovery buttons:
 * UI doesn't need to know checkpoint IDs.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
) {
  const { runId } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }

  const store = await getStore();
  const cp = await store.findNearestCheckpointBeforeNode(
    runId,
    parsed.data.branchId,
    parsed.data.beforeNodeId,
  );
  if (!cp) {
    return NextResponse.json(
      { error: "No checkpoint exists before that node — there's nothing to restore to.", restored: false },
      { status: 404 },
    );
  }

  const memory = (cp.memoryJson ?? {}) as Record<string, unknown>;
  const snapshotPath = typeof memory.__snapshotPath === "string" ? memory.__snapshotPath : null;
  if (!snapshotPath) {
    return NextResponse.json(
      {
        error: `Checkpoint ${cp.id} has no filesystem snapshot attached.`,
        checkpointId: cp.id,
        restored: false,
      },
      { status: 409 },
    );
  }

  const sandboxRoot = getSandboxRoot(runId) ?? defaultSandboxRoot();

  try {
    const result = await restoreSnapshot(snapshotPath, sandboxRoot);
    return NextResponse.json(
      {
        restored: true,
        checkpointId: cp.id,
        sandboxRoot,
        snapshotPath,
        filesRestored: result.filesRestored,
        filesRemoved: result.filesRemoved,
      },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), restored: false },
      { status: 500 },
    );
  }
}
