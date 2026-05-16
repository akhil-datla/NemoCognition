import { randomUUID } from "crypto";
import { z } from "zod";
import type { Store } from "@nemocognition/db";
import { buildExecutionGraph } from "@nemocognition/core/graph/graph-builder";
import { ingestTrackerEvents } from "@nemocognition/tracing";
import type {
  Run,
  Branch,
  Checkpoint,
  VideoJob,
  ExecutionNode,
  PolicyDecisionEvent,
  ValidationResult,
} from "@nemocognition/core";

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

interface ErrorBody {
  error: unknown;
}

const createRunInput = z.object({
  title: z.string().min(1),
  userTask: z.string().min(1),
});

export async function handleCreateRun(
  store: Store,
  input: unknown,
): Promise<ApiResponse<Run | ErrorBody>> {
  const parsed = createRunInput.safeParse(input);
  if (!parsed.success) {
    return { status: 400, body: { error: parsed.error.format() } };
  }

  const id = `run_${randomUUID().slice(0, 8)}`;
  const rootBranchId = `branch_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  const run: Run = {
    id,
    title: parsed.data.title,
    userTask: parsed.data.userTask,
    status: "pending",
    createdAt: now,
    completedAt: null,
    rootBranchId,
  };
  await store.setRun(run);

  const branch: Branch = {
    id: rootBranchId,
    runId: id,
    parentBranchId: null,
    forkNodeId: null,
    status: "running",
    correctionSummary: null,
    createdAt: now,
  };
  await store.setBranch(branch);

  return { status: 201, body: run };
}

export async function handleGetRun(store: Store, runId: string): Promise<ApiResponse<Run | ErrorBody>> {
  const run = await store.getRun(runId);
  if (!run) return { status: 404, body: { error: "Run not found" } };
  return { status: 200, body: run };
}

export async function handleGetGraph(
  store: Store,
  runId: string,
): Promise<ApiResponse<{ nodes: unknown[]; edges: unknown[] } | ErrorBody>> {
  const run = await store.getRun(runId);
  if (!run) return { status: 404, body: { error: "Run not found" } };
  const nodes = await store.getRunNodes(runId);
  const graph = buildExecutionGraph(nodes);
  return { status: 200, body: graph };
}

export async function handleGetNode(
  store: Store,
  runId: string,
  nodeId: string,
): Promise<ApiResponse<ExecutionNode | ErrorBody>> {
  const node = await store.getNode(nodeId);
  if (!node || node.runId !== runId) {
    return { status: 404, body: { error: "Node not found" } };
  }
  return { status: 200, body: node };
}

export async function handleGetNodeState(
  store: Store,
  runId: string,
  nodeId: string,
): Promise<
  ApiResponse<
    | { node: ExecutionNode; validation: ValidationResult | null; policyDecision: PolicyDecisionEvent | null }
    | ErrorBody
  >
> {
  const node = await store.getNode(nodeId);
  if (!node || node.runId !== runId) {
    return { status: 404, body: { error: "Node not found" } };
  }
  const validation = (await store.getNodeValidation(runId, nodeId)) ?? null;
  const policyDecision = (await store.getNodePolicyDecision(runId, nodeId)) ?? null;
  return { status: 200, body: { node, validation, policyDecision } };
}

const createBranchInput = z.object({
  forkNodeId: z.string().min(1),
  correctionSummary: z.string().nullable().optional(),
});

export async function handleCreateBranch(
  store: Store,
  runId: string,
  input: unknown,
): Promise<ApiResponse<Branch | ErrorBody>> {
  const parsed = createBranchInput.safeParse(input);
  if (!parsed.success) {
    return { status: 400, body: { error: parsed.error.format() } };
  }
  const run = await store.getRun(runId);
  if (!run) return { status: 404, body: { error: "Run not found" } };

  const id = `branch_${randomUUID().slice(0, 8)}`;
  const branch: Branch = {
    id,
    runId,
    parentBranchId: run.rootBranchId,
    forkNodeId: parsed.data.forkNodeId,
    status: "running",
    correctionSummary: parsed.data.correctionSummary ?? null,
    createdAt: new Date().toISOString(),
  };
  await store.setBranch(branch);
  return { status: 201, body: branch };
}

const fixAndRerunInput = z.object({
  failedNodeId: z.string().min(1),
  checkpointId: z.string().min(1),
  humanCorrection: z.string().min(1),
  recoveryStrategy: z.enum(["replan_within_policy", "suggest_policy_change", "rerun_stricter_sandbox"]),
});

export interface FixAndRerunResult {
  newBranchId: string;
  correctionPrompt: string;
  /**
   * Restored state the NemoClaw runtime should resume from. `null` when the
   * checkpoint ID didn't resolve. The runtime is responsible for actually
   * rehydrating memory + policy on startup.
   */
  restoredState: {
    memory: Record<string, unknown> | null;
    policyYaml: string | null;
  } | null;
}

export async function handleFixAndRerun(
  store: Store,
  runId: string,
  input: unknown,
): Promise<ApiResponse<FixAndRerunResult | ErrorBody>> {
  const parsed = fixAndRerunInput.safeParse(input);
  if (!parsed.success) {
    return { status: 400, body: { error: parsed.error.format() } };
  }

  const newBranchId = `branch_recovery_${randomUUID().slice(0, 8)}`;

  let correctionPrompt: string;
  switch (parsed.data.recoveryStrategy) {
    case "replan_within_policy":
      correctionPrompt = [
        `You are resuming from checkpoint ${parsed.data.checkpointId}.`,
        `The previous branch was blocked at node ${parsed.data.failedNodeId}.`,
        `Human correction: ${parsed.data.humanCorrection}.`,
        `Continue using only allowed resources.`,
      ].join("\n");
      break;
    case "suggest_policy_change":
      correctionPrompt = `Policy change suggested for checkpoint ${parsed.data.checkpointId}.`;
      break;
    case "rerun_stricter_sandbox":
      correctionPrompt = `Rerunning in stricter sandbox from ${parsed.data.checkpointId}.`;
      break;
  }

  // The new branch is a *sibling* of the failed branch — its parent is whatever
  // branch the failed node belonged to. Look that up from the failed node so
  // recovery branches stay correctly linked in the graph.
  const failedNode = await store.getNode(parsed.data.failedNodeId);
  const parentBranchId = failedNode?.branchId ?? null;

  // Mark the failed branch as `failed` so the dashboard / replay UI can
  // distinguish it from the in-progress recovery.
  if (failedNode?.branchId) {
    const failedBranch = await store.getBranch(failedNode.branchId);
    if (failedBranch && failedBranch.status !== "failed") {
      await store.setBranch({ ...failedBranch, status: "failed" });
    }
  }

  const branch: Branch = {
    id: newBranchId,
    runId,
    parentBranchId,
    forkNodeId: parsed.data.failedNodeId,
    status: "running",
    correctionSummary: parsed.data.humanCorrection,
    createdAt: new Date().toISOString(),
  };
  await store.setBranch(branch);

  const cp = await store.getCheckpoint(parsed.data.checkpointId);
  const restoredState = cp
    ? { memory: cp.memoryJson ?? null, policyYaml: cp.policyYaml ?? null }
    : null;

  return { status: 201, body: { newBranchId, correctionPrompt, restoredState } };
}

export async function handleCreateVideo(
  store: Store,
  runId: string,
): Promise<ApiResponse<VideoJob | ErrorBody>> {
  const run = await store.getRun(runId);
  if (!run) return { status: 404, body: { error: "Run not found" } };

  const id = `video_${randomUUID().slice(0, 8)}`;
  const job: VideoJob = {
    id,
    runId,
    status: "pending",
    inputTraceRef: `phoenix/trace/${runId}`,
    outputVideoRef: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  await store.setVideoJob(job);
  return { status: 201, body: job };
}

export async function handleGetVideoJob(
  store: Store,
  runId: string,
  jobId: string,
): Promise<ApiResponse<VideoJob | ErrorBody>> {
  const job = await store.getVideoJob(jobId);
  if (!job || job.runId !== runId) {
    return { status: 404, body: { error: "Video job not found" } };
  }
  return { status: 200, body: job };
}

export async function handleGetRunPolicy(
  store: Store,
  runId: string,
): Promise<ApiResponse<{ decisions: PolicyDecisionEvent[] }>> {
  const decisions = await store.getRunPolicyDecisions(runId);
  return { status: 200, body: { decisions } };
}

export interface RestoredCheckpoint {
  checkpoint: Checkpoint;
  /**
   * The restored state a recovery branch would resume from. The NemoClaw
   * runtime is responsible for actually rehydrating this into a live session
   * on startup — this handler is the read-side: it returns what the runtime
   * should be initialised with.
   */
  state: {
    memory: Record<string, unknown> | null;
    policyYaml: string | null;
  };
}

export async function handleRestoreCheckpoint(
  store: Store,
  checkpointId: string,
): Promise<ApiResponse<RestoredCheckpoint | ErrorBody>> {
  const cp = await store.getCheckpoint(checkpointId);
  if (!cp) return { status: 404, body: { error: "Checkpoint not found" } };
  return {
    status: 200,
    body: {
      checkpoint: cp,
      state: {
        memory: cp.memoryJson ?? null,
        policyYaml: cp.policyYaml ?? null,
      },
    },
  };
}

export async function handleGetRunAudit(
  store: Store,
  runId: string,
): Promise<ApiResponse<{ events: PolicyDecisionEvent[] }>> {
  const decisions = await store.getRunPolicyDecisions(runId);
  return { status: 200, body: { events: decisions } };
}

interface ImportResult {
  runId: string;
  nodeCount: number;
  branchCount: number;
  checkpointCount: number;
  policyDecisionCount: number;
}

export async function handleImportRun(
  store: Store,
  input: unknown,
): Promise<ApiResponse<ImportResult | ErrorBody>> {
  const eventsParse = z.object({ events: z.array(z.any()) }).safeParse(input);
  if (!eventsParse.success) {
    return { status: 400, body: { error: "Expected { events: TrackerEvent[] }" } };
  }
  const ingest = ingestTrackerEvents(eventsParse.data.events);
  if (!ingest.run) {
    return { status: 400, body: { error: "Events did not include a run_start" } };
  }
  await store.setRun(ingest.run);
  for (const b of ingest.branches) await store.setBranch(b);
  for (const n of ingest.nodes) await store.setNode(n);
  for (const c of ingest.checkpoints) await store.setCheckpoint(c);
  for (const p of ingest.policyDecisions) await store.setPolicyDecision(p);
  return {
    status: 201,
    body: {
      runId: ingest.run.id,
      nodeCount: ingest.nodes.length,
      branchCount: ingest.branches.length,
      checkpointCount: ingest.checkpoints.length,
      policyDecisionCount: ingest.policyDecisions.length,
    },
  };
}
