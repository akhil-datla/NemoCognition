import { randomUUID } from "crypto";
import { z } from "zod";
import { InMemoryStore } from "@nemocognition/db";
import { buildExecutionGraph } from "@nemocognition/core/graph/graph-builder";
import type { Run, Branch, VideoJob } from "@nemocognition/core";

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

const createRunInput = z.object({
  title: z.string().min(1),
  userTask: z.string().min(1),
});

export function handleCreateRun(store: InMemoryStore, input: unknown): ApiResponse {
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
  store.runs.set(id, run);

  const branch: Branch = {
    id: rootBranchId,
    runId: id,
    parentBranchId: null,
    forkNodeId: null,
    status: "running",
    correctionSummary: null,
    createdAt: now,
  };
  store.branches.set(rootBranchId, branch);

  return { status: 201, body: run };
}

export function handleGetRun(store: InMemoryStore, runId: string): ApiResponse {
  const run = store.runs.get(runId);
  if (!run) return { status: 404, body: { error: "Run not found" } };
  return { status: 200, body: run };
}

export function handleGetGraph(store: InMemoryStore, runId: string): ApiResponse {
  const run = store.runs.get(runId);
  if (!run) return { status: 404, body: { error: "Run not found" } };
  const nodes = store.getRunNodes(runId);
  const graph = buildExecutionGraph(nodes);
  return { status: 200, body: graph };
}

export function handleGetNode(store: InMemoryStore, runId: string, nodeId: string): ApiResponse {
  const node = store.nodes.get(nodeId);
  if (!node || node.runId !== runId) {
    return { status: 404, body: { error: "Node not found" } };
  }
  return { status: 200, body: node };
}

export function handleGetNodeState(store: InMemoryStore, runId: string, nodeId: string): ApiResponse {
  const node = store.nodes.get(nodeId);
  if (!node || node.runId !== runId) {
    return { status: 404, body: { error: "Node not found" } };
  }
  const validation = [...store.validations.values()].find(
    v => v.runId === runId && v.nodeId === nodeId
  );
  const policyDecision = store.getNodePolicyDecision(runId, nodeId);
  return {
    status: 200,
    body: { node, validation: validation ?? null, policyDecision: policyDecision ?? null },
  };
}

const createBranchInput = z.object({
  forkNodeId: z.string().min(1),
  correctionSummary: z.string().nullable().optional(),
});

export function handleCreateBranch(store: InMemoryStore, runId: string, input: unknown): ApiResponse {
  const parsed = createBranchInput.safeParse(input);
  if (!parsed.success) {
    return { status: 400, body: { error: parsed.error.format() } };
  }
  const run = store.runs.get(runId);
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
  store.branches.set(id, branch);
  return { status: 201, body: branch };
}

const fixAndRerunInput = z.object({
  failedNodeId: z.string().min(1),
  checkpointId: z.string().min(1),
  humanCorrection: z.string().min(1),
  recoveryStrategy: z.enum(["replan_within_policy", "suggest_policy_change", "rerun_stricter_sandbox"]),
});

export function handleFixAndRerun(store: InMemoryStore, runId: string, input: unknown): ApiResponse {
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

  const branch: Branch = {
    id: newBranchId,
    runId,
    parentBranchId: null,
    forkNodeId: parsed.data.failedNodeId,
    status: "running",
    correctionSummary: parsed.data.humanCorrection,
    createdAt: new Date().toISOString(),
  };
  store.branches.set(newBranchId, branch);

  return {
    status: 201,
    body: { newBranchId, correctionPrompt },
  };
}

export function handleCreateVideo(store: InMemoryStore, runId: string): ApiResponse {
  const run = store.runs.get(runId);
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
  store.videoJobs.set(id, job);
  return { status: 201, body: job };
}

export function handleGetVideoJob(store: InMemoryStore, runId: string, jobId: string): ApiResponse {
  const job = store.videoJobs.get(jobId);
  if (!job || job.runId !== runId) {
    return { status: 404, body: { error: "Video job not found" } };
  }
  return { status: 200, body: job };
}

export function handleGetRunPolicy(store: InMemoryStore, runId: string): ApiResponse {
  const decisions = store.getRunPolicyDecisions(runId);
  return { status: 200, body: { decisions } };
}

export function handleGetRunAudit(store: InMemoryStore, runId: string): ApiResponse {
  const decisions = store.getRunPolicyDecisions(runId);
  return { status: 200, body: { events: decisions } };
}
