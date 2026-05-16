import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { Checkpoint } from "@nemocognition/core";
import { getStore } from "@/lib/store-factory";
import { snapper, sandboxRootForRun } from "@/lib/snapper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/checkpoints/:cpId/restore
 *
 * Two-phase restore:
 *  1. Snapshot the *current* sandbox into a new "pre_restore" checkpoint so
 *     the action is reversible.
 *  2. Wipe the sandbox and extract the target snapshot.
 *
 * Returns { preRestoreCheckpointId, restoredFromCheckpointId, restoredCount }.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ cpId: string }> },
) {
  const { cpId } = await params;
  const store = await getStore();
  const target = await store.getCheckpoint(cpId);
  if (!target) return NextResponse.json({ error: "Checkpoint not found" }, { status: 404 });
  if (!target.diffRef) {
    return NextResponse.json(
      { error: "Checkpoint has no filesystem snapshot" },
      { status: 404 },
    );
  }

  const targetManifest = await snapper.readManifest(target.diffRef);
  if (!targetManifest) {
    return NextResponse.json({ error: "Snapshot manifest missing" }, { status: 410 });
  }
  const sandboxRoot = targetManifest.sandboxRoot || sandboxRootForRun(target.runId);

  // Phase 1: auto-snap current state and persist a Checkpoint row.
  const preCpId = `cp_pr_${randomUUID().slice(0, 8)}`;
  const preSnap = await snapper.snapshot({
    runId: target.runId,
    branchId: target.branchId,
    nodeId: `restore_${cpId}`,
    kind: "pre_restore",
    sandboxRoot,
    cpId: preCpId,
  });
  const preCheckpoint: Checkpoint = {
    id: preCpId,
    runId: target.runId,
    nodeId: `restore_${cpId}`,
    branchId: target.branchId,
    memoryRef: null,
    contextRef: null,
    promptRef: null,
    diffRef: preSnap.artifactPath,
    fileTreeHashRef: preSnap.checksum,
    envRef: null,
    policyRef: null,
    policyResolvedRef: null,
    auditWindowRef: null,
    validationRef: null,
    parentCheckpointId: cpId,
    phoenixTraceRef: null,
    memoryJson: {
      __snapshot: {
        artifactPath: preSnap.artifactPath,
        checksum: preSnap.checksum,
        fileCount: preSnap.fileCount,
        kind: "pre_restore",
      },
    },
    policyYaml: null,
    createdAt: preSnap.createdAt,
  };
  await store.setCheckpoint(preCheckpoint);

  // Phase 2: wipe sandbox + extract target.
  await snapper.extract(target.diffRef, sandboxRoot);

  return NextResponse.json({
    preRestoreCheckpointId: preCpId,
    restoredFromCheckpointId: cpId,
    restoredCount: targetManifest.fileCount,
    sandboxRoot,
  });
}
