import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store-factory";
import { SessionRunner } from "@/lib/session-runner";
import { snapper, sandboxRootForRun } from "@/lib/snapper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const recoverInput = z.object({
  failedNodeId: z.string().min(1),
});

/**
 * POST /api/runs/:runId/recover
 *
 * Spin up a recovery branch in the same run:
 *  1. Look up the failed ExecutionNode + nearest checkpoint.
 *  2. Restore the sandbox to that checkpoint (auto-snapping current state
 *     into a `pre_restore` checkpoint first).
 *  3. Persist the new branch row eagerly so the graph shows it instantly.
 *  4. Build a recovery prompt with failure context and kick off a
 *     SessionRunner in branch mode. It runs in the background; the caller
 *     polls /graph until the new branch's nodes appear.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const apiKey = process.env.NIM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "NIM_API_KEY is not configured on the server" },
      { status: 503 },
    );
  }

  const { runId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = recoverInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }

  const store = await getStore();
  const run = await store.getRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const failedNode = await store.getNode(parsed.data.failedNodeId);
  if (!failedNode || failedNode.runId !== runId) {
    return NextResponse.json({ error: "Failed node not found in this run" }, { status: 404 });
  }

  const checkpoint = await store.findNearestCheckpointBeforeNode(
    runId,
    failedNode.branchId,
    failedNode.nodeId,
  );

  // Sandbox root: prefer the snapshot's recorded sandboxRoot; fall back to the
  // canonical per-run path.
  let sandboxRoot = sandboxRootForRun(runId);
  if (checkpoint?.diffRef) {
    const manifest = await snapper.readManifest(checkpoint.diffRef);
    if (manifest?.sandboxRoot) sandboxRoot = manifest.sandboxRoot;
    // Restore the sandbox to the pre-failure state.
    await snapper.extract(checkpoint.diffRef, sandboxRoot);
  }

  // Build a human-readable summary of what failed.
  const failureCategory =
    (failedNode.payload as { errorClass?: string } | null)?.errorClass ??
    failedNode.title ??
    failedNode.type;
  const correctionSummary = `Recovery from ${failedNode.type}: ${failedNode.title}`;

  // Eagerly persist the branch row so the graph picks up the new lane right
  // away — the runner will overwrite this with its own branch_start emission
  // when it runs (idempotent upsert).
  const newBranchId = `branch_recovery_${Math.random().toString(36).slice(2, 10)}`;
  await store.setBranch({
    id: newBranchId,
    runId,
    parentBranchId: failedNode.branchId,
    forkNodeId: failedNode.nodeId,
    status: "running",
    correctionSummary,
    createdAt: new Date().toISOString(),
  });

  // Mark the failed branch as `failed` so the UI distinguishes it.
  const failedBranch = await store.getBranch(failedNode.branchId);
  if (failedBranch && failedBranch.status !== "failed") {
    await store.setBranch({ ...failedBranch, status: "failed" });
  }

  const recoveryTask = [
    `You are resuming a coding task in a recovery branch.`,
    ``,
    `ORIGINAL TASK: ${run.userTask}`,
    ``,
    `Your previous attempt failed at this step:`,
    `- Node: ${failedNode.title}`,
    `- Type: ${failedNode.type}`,
    `- Summary: ${failedNode.summary}`,
    `- Failure: ${failureCategory}`,
    ``,
    checkpoint
      ? `The sandbox has been restored to the state captured at checkpoint ${checkpoint.id} just BEFORE that failed step.`
      : `No pre-failure snapshot was available; the sandbox is in its current state.`,
    ``,
    `Try a DIFFERENT approach to complete the original task. Do not retry the failed action verbatim. Be concise.`,
  ].join("\n");

  const runner = SessionRunner.fromBranch(
    {
      store,
      nimEndpoint:
        process.env.NIM_ENDPOINT ??
        process.env.NVIDIA_NIM_BASE_URL ??
        "https://integrate.api.nvidia.com/v1",
      nimApiKey: apiKey,
      nimModel:
        process.env.NIM_MODEL ??
        process.env.NVIDIA_NIM_MODEL ??
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      phoenixEndpoint:
        process.env.PHOENIX_ENDPOINT ??
        process.env.PHOENIX_BASE_URL ??
        "http://localhost:6006",
      sandboxRoot,
    },
    {
      runId,
      parentBranchId: failedNode.branchId,
      forkNodeId: failedNode.nodeId,
      branchId: newBranchId,
      correctionSummary,
      checkpointId: checkpoint?.id,
      failureCategory,
    },
  );

  void runner.run(recoveryTask).catch(() => {
    /* surfaced via the runner's error event */
  });

  return NextResponse.json(
    {
      runId,
      branchId: newBranchId,
      forkNodeId: failedNode.nodeId,
      restoredCheckpointId: checkpoint?.id ?? null,
      sandboxRoot,
    },
    { status: 201 },
  );
}
