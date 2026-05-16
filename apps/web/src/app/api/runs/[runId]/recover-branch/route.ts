import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store-factory";
import { SessionRunner } from "@/lib/session-runner";
import { registerRunner } from "@/lib/session-registry";
import { getSandboxRoot, defaultSandboxRoot, setSandboxRoot } from "@/lib/sandbox-registry";
import { restoreSnapshot } from "@/lib/snapshot";
import { DEFAULT_POLICY } from "@nemocognition/nemoclaw";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const inputSchema = z.object({
  failedNodeId: z.string().min(1),
  branchId: z.string().min(1),
});

/**
 * Recovery flow for a failed node:
 *   1. Find the nearest checkpoint before the failure on the same branch.
 *   2. Restore the sandbox filesystem from that checkpoint's snapshot.
 *   3. Spawn a new agent loop *on the same runId, new branchId*, with an
 *      augmented prompt explaining the denial. The new branch streams events
 *      under the original run.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
) {
  const apiKey = process.env.NIM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "NIM_API_KEY is not configured on the server" },
      { status: 503 },
    );
  }

  const { runId } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }

  const store = await getStore();
  const run = await store.getRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const cp = await store.findNearestCheckpointBeforeNode(
    runId,
    parsed.data.branchId,
    parsed.data.failedNodeId,
  );
  if (!cp) {
    return NextResponse.json(
      { error: "No prior checkpoint exists for this branch — nothing to recover from." },
      { status: 404 },
    );
  }

  const memory = (cp.memoryJson ?? {}) as Record<string, unknown>;
  const snapshotPath = typeof memory.__snapshotPath === "string" ? memory.__snapshotPath : null;

  const sandboxRoot = getSandboxRoot(runId) ?? defaultSandboxRoot();

  let filesRestored = 0;
  let filesRemoved = 0;
  if (snapshotPath) {
    try {
      const r = await restoreSnapshot(snapshotPath, sandboxRoot);
      filesRestored = r.filesRestored;
      filesRemoved = r.filesRemoved;
    } catch (err) {
      return NextResponse.json(
        { error: `Snapshot restore failed: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 },
      );
    }
  }

  // Find the policy decision (if any) at the failed node so we can give the
  // model real deny context in the prompt.
  const decisions = await store.getRunPolicyDecisions(runId);
  const failedDecision = decisions.find(
    (d) => d.nodeId === parsed.data.failedNodeId && d.decision === "deny",
  );
  const denyContext = failedDecision
    ? [
        "Your previous attempt was DENIED BY POLICY:",
        `  rule: ${failedDecision.policyRuleId} (${failedDecision.policyRuleText})`,
        `  resource: ${failedDecision.resource}`,
        `  reason: ${failedDecision.reason}`,
        "Plan an alternative approach that does not access that resource.",
      ].join("\n")
    : "Your previous attempt failed. Try a different approach.";

  const augmentedTask = `${run.userTask}\n\n${denyContext}`;

  const runner = new SessionRunner(
    {
      store,
      nimEndpoint: process.env.NIM_ENDPOINT ?? "https://integrate.api.nvidia.com/v1",
      nimApiKey: apiKey,
      nimModel: process.env.NIM_MODEL ?? "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      phoenixEndpoint: process.env.PHOENIX_ENDPOINT ?? "http://localhost:6006",
      sandboxRoot,
      policy: DEFAULT_POLICY,
      resumeBranch: {
        runId,
        parentBranchId: parsed.data.branchId,
        parentNodeId: parsed.data.failedNodeId,
      },
    },
    `Recovery: ${run.title}`,
    augmentedTask,
  );
  registerRunner(runner);
  setSandboxRoot(runner.getRunId(), sandboxRoot);

  void runner.run(augmentedTask).catch(() => {
    /* errors surface via SSE error event */
  });

  return NextResponse.json(
    {
      runId,
      newBranchId: runner.branchId,
      restored: snapshotPath !== null,
      filesRestored,
      filesRemoved,
      checkpointId: cp.id,
      sseUrl: `/api/sessions/${runId}/events`,
    },
    { status: 201 },
  );
}
