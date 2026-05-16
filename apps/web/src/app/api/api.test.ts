import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore } from "@nemocognition/db";
import {
  handleCreateRun,
  handleGetRun,
  handleGetGraph,
  handleGetNode,
  handleCreateBranch,
  handleFixAndRerun,
  handleCreateVideo,
  handleGetVideoJob,
  handleGetRunPolicy,
  handleGetRunAudit,
  handleImportRun,
  handleRestoreCheckpoint,
} from "./handlers";

// Tests freely access properties on body unions; cast at the access site.
const body = <T>(r: { body: unknown }): T => r.body as T;

let store: InMemoryStore;

beforeEach(() => {
  store = new InMemoryStore();
});

describe("POST /api/runs", () => {
  it("creates a run with valid input", async () => {
    const result = await handleCreateRun(store, {
      title: "Research report",
      userTask: "Create a report from research docs",
    });
    expect(result.status).toBe(201);
    expect(body<{ id: string; status: string; rootBranchId: string }>(result).id).toBeTruthy();
    expect(body<{ status: string }>(result).status).toBe("pending");
    expect(body<{ rootBranchId: string }>(result).rootBranchId).toBeTruthy();
  });

  it("rejects empty title", async () => {
    const result = await handleCreateRun(store, { title: "", userTask: "task" });
    expect(result.status).toBe(400);
  });
});

describe("GET /api/runs/:runId", () => {
  it("returns a run by ID", async () => {
    const created = await handleCreateRun(store, { title: "Test", userTask: "task" });
    const result = await handleGetRun(store, body<{ id: string }>(created).id);
    expect(result.status).toBe(200);
    expect(body<{ id: string }>(result).id).toBe(body<{ id: string }>(created).id);
  });

  it("returns 404 for unknown run", async () => {
    const result = await handleGetRun(store, "nonexistent");
    expect(result.status).toBe(404);
  });
});

describe("GET /api/runs/:runId/graph", () => {
  it("returns empty graph for run with no nodes", async () => {
    const created = await handleCreateRun(store, { title: "Test", userTask: "task" });
    const result = await handleGetGraph(store, body<{ id: string }>(created).id);
    expect(result.status).toBe(200);
    expect(body<{ nodes: unknown[]; edges: unknown[] }>(result).nodes).toEqual([]);
    expect(body<{ nodes: unknown[]; edges: unknown[] }>(result).edges).toEqual([]);
  });

  it("returns graph with nodes", async () => {
    const created = await handleCreateRun(store, { title: "Test", userTask: "task" });
    const c = body<{ id: string; rootBranchId: string }>(created);
    await store.setNode({
      nodeId: "n1",
      runId: c.id,
      branchId: c.rootBranchId,
      parentNodeId: null,
      checkpointId: null,
      type: "agent_message",
      status: "success",
      title: "Start",
      summary: "Started",
      startedAt: "2026-05-15T10:00:00Z",
      endedAt: null,
      payloadRef: null,
      validationRef: null,
    });
    const result = await handleGetGraph(store, c.id);
    expect(body<{ nodes: unknown[] }>(result).nodes).toHaveLength(1);
  });
});

describe("GET /api/runs/:runId/nodes/:nodeId", () => {
  it("returns a node by ID", async () => {
    const created = await handleCreateRun(store, { title: "Test", userTask: "task" });
    const c = body<{ id: string }>(created);
    await store.setNode({
      nodeId: "n1",
      runId: c.id,
      branchId: "b1",
      parentNodeId: null,
      checkpointId: null,
      type: "tool_call",
      status: "success",
      title: "Node",
      summary: "Summary",
      startedAt: "2026-05-15T10:00:00Z",
      endedAt: null,
      payloadRef: null,
      validationRef: null,
    });
    const result = await handleGetNode(store, c.id, "n1");
    expect(result.status).toBe(200);
    expect(body<{ nodeId: string }>(result).nodeId).toBe("n1");
  });

  it("returns 404 for unknown node", async () => {
    const created = await handleCreateRun(store, { title: "Test", userTask: "task" });
    const result = await handleGetNode(store, body<{ id: string }>(created).id, "nope");
    expect(result.status).toBe(404);
  });
});

describe("POST /api/runs/:runId/branches", () => {
  it("creates a branch", async () => {
    const created = await handleCreateRun(store, { title: "Test", userTask: "task" });
    const result = await handleCreateBranch(store, body<{ id: string }>(created).id, {
      forkNodeId: "n3",
      correctionSummary: "Fix the issue",
    });
    expect(result.status).toBe(201);
    expect(body<{ id: string; forkNodeId: string }>(result).id).toBeTruthy();
    expect(body<{ forkNodeId: string }>(result).forkNodeId).toBe("n3");
  });
});

describe("POST /api/runs/:runId/fix-and-rerun — branch linkage", () => {
  it("links new branch to the failed node's branch and marks failed branch as failed", async () => {
    const created = await handleCreateRun(store, { title: "T", userTask: "t" });
    const runId = body<{ id: string; rootBranchId: string }>(created).id;
    const rootBranchId = body<{ rootBranchId: string }>(created).rootBranchId;
    await store.setNode({
      nodeId: "n_failed",
      runId,
      branchId: rootBranchId,
      parentNodeId: null,
      checkpointId: null,
      type: "policy_deny",
      status: "failure",
      title: "Denied",
      summary: "",
      startedAt: "2026-05-15T10:00:00Z",
      endedAt: null,
      payloadRef: null,
      validationRef: null,
    });
    const result = await handleFixAndRerun(store, runId, {
      failedNodeId: "n_failed",
      checkpointId: "cp_x",
      humanCorrection: "fix",
      recoveryStrategy: "replan_within_policy",
    });
    expect(result.status).toBe(201);
    const b = body<{ newBranchId: string }>(result);
    const newBranch = await store.getBranch(b.newBranchId);
    expect(newBranch?.parentBranchId).toBe(rootBranchId);

    // Original branch is now marked failed.
    const origBranch = await store.getBranch(rootBranchId);
    expect(origBranch?.status).toBe("failed");
  });

  it("leaves parentBranchId null when failed node is unknown", async () => {
    const created = await handleCreateRun(store, { title: "T", userTask: "t" });
    const runId = body<{ id: string }>(created).id;
    const result = await handleFixAndRerun(store, runId, {
      failedNodeId: "n_does_not_exist",
      checkpointId: "cp",
      humanCorrection: "fix",
      recoveryStrategy: "replan_within_policy",
    });
    const b = body<{ newBranchId: string }>(result);
    const newBranch = await store.getBranch(b.newBranchId);
    expect(newBranch?.parentBranchId).toBeNull();
  });
});

describe("POST /api/runs/:runId/fix-and-rerun", () => {
  it("creates a recovery branch and correction nodes", async () => {
    const created = await handleCreateRun(store, { title: "Test", userTask: "task" });
    const result = await handleFixAndRerun(store, body<{ id: string }>(created).id, {
      failedNodeId: "n5",
      checkpointId: "cp_1",
      humanCorrection: "Avoid private files",
      recoveryStrategy: "replan_within_policy",
    });
    expect(result.status).toBe(201);
    expect(body<{ newBranchId: string; correctionPrompt: string }>(result).newBranchId).toBeTruthy();
    expect(body<{ correctionPrompt: string }>(result).correctionPrompt).toContain("cp_1");
  });
});

describe("POST /api/runs/:runId/video", () => {
  it("queues a video job", async () => {
    const created = await handleCreateRun(store, { title: "Test", userTask: "task" });
    const result = await handleCreateVideo(store, body<{ id: string }>(created).id);
    expect(result.status).toBe(201);
    expect(body<{ status: string }>(result).status).toBe("pending");
  });
});

describe("GET /api/runs/:runId/video/:jobId", () => {
  it("returns video job status", async () => {
    const created = await handleCreateRun(store, { title: "Test", userTask: "task" });
    const c = body<{ id: string }>(created);
    const videoResult = await handleCreateVideo(store, c.id);
    const result = await handleGetVideoJob(store, c.id, body<{ id: string }>(videoResult).id);
    expect(result.status).toBe(200);
    expect(body<{ status: string }>(result).status).toBe("pending");
  });

  it("returns 404 for unknown job", async () => {
    const created = await handleCreateRun(store, { title: "Test", userTask: "task" });
    const result = await handleGetVideoJob(store, body<{ id: string }>(created).id, "nope");
    expect(result.status).toBe(404);
  });
});

describe("GET /api/runs/:runId/policy", () => {
  it("returns policy decisions for a run", async () => {
    const created = await handleCreateRun(store, { title: "Test", userTask: "task" });
    const result = await handleGetRunPolicy(store, body<{ id: string }>(created).id);
    expect(result.status).toBe(200);
    expect(body<{ decisions: unknown[] }>(result).decisions).toEqual([]);
  });
});

describe("GET /api/runs/:runId/audit", () => {
  it("returns audit events for a run", async () => {
    const created = await handleCreateRun(store, { title: "Test", userTask: "task" });
    const result = await handleGetRunAudit(store, body<{ id: string }>(created).id);
    expect(result.status).toBe(200);
    expect(body<{ events: unknown[] }>(result).events).toEqual([]);
  });
});

describe("GET /api/checkpoints/:id/restore", () => {
  it("returns the checkpoint and its restored state", async () => {
    await store.setCheckpoint({
      id: "cp_restore",
      runId: "r_x",
      nodeId: "n_x",
      branchId: "b_x",
      memoryRef: null,
      contextRef: null,
      promptRef: null,
      diffRef: null,
      fileTreeHashRef: null,
      envRef: null,
      policyRef: null,
      policyResolvedRef: null,
      auditWindowRef: null,
      validationRef: null,
      parentCheckpointId: null,
      phoenixTraceRef: null,
      memoryJson: { findings: "scaling laws" },
      policyYaml: "files:\n  allow_read:\n    - ./research/**",
      createdAt: "2026-05-15T10:00:00.000Z",
    });
    const result = await handleRestoreCheckpoint(store, "cp_restore");
    expect(result.status).toBe(200);
    const b = body<{ checkpoint: { id: string }; state: { memory: Record<string, unknown>; policyYaml: string } }>(result);
    expect(b.checkpoint.id).toBe("cp_restore");
    expect(b.state.memory).toEqual({ findings: "scaling laws" });
    expect(b.state.policyYaml).toContain("allow_read");
  });

  it("returns 404 for an unknown checkpoint", async () => {
    const result = await handleRestoreCheckpoint(store, "nope");
    expect(result.status).toBe(404);
  });
});

describe("POST /api/runs/:runId/fix-and-rerun (with checkpoint)", () => {
  it("includes restoredState when the checkpointId resolves", async () => {
    const created = await handleCreateRun(store, { title: "T", userTask: "t" });
    const runId = body<{ id: string }>(created).id;
    await store.setCheckpoint({
      id: "cp_resume",
      runId,
      nodeId: "n_resume",
      branchId: "b_main",
      memoryRef: null,
      contextRef: null,
      promptRef: null,
      diffRef: null,
      fileTreeHashRef: null,
      envRef: null,
      policyRef: null,
      policyResolvedRef: null,
      auditWindowRef: null,
      validationRef: null,
      parentCheckpointId: null,
      phoenixTraceRef: null,
      memoryJson: { stage: "research" },
      policyYaml: "deny_read: ./private/**",
      createdAt: "2026-05-15T10:00:00.000Z",
    });
    const result = await handleFixAndRerun(store, runId, {
      failedNodeId: "n_fail",
      checkpointId: "cp_resume",
      humanCorrection: "skip private files",
      recoveryStrategy: "replan_within_policy",
    });
    expect(result.status).toBe(201);
    const b = body<{ newBranchId: string; correctionPrompt: string; restoredState: { memory: Record<string, unknown>; policyYaml: string } }>(result);
    expect(b.restoredState.memory).toEqual({ stage: "research" });
    expect(b.restoredState.policyYaml).toContain("./private/**");
  });

  it("returns null restoredState when checkpoint is missing", async () => {
    const created = await handleCreateRun(store, { title: "T", userTask: "t" });
    const result = await handleFixAndRerun(store, body<{ id: string }>(created).id, {
      failedNodeId: "n",
      checkpointId: "cp_missing",
      humanCorrection: "x",
      recoveryStrategy: "replan_within_policy",
    });
    const b = body<{ restoredState: unknown }>(result);
    expect(b.restoredState).toBeNull();
  });
});

describe("POST /api/runs/import", () => {
  it("rejects payloads without events", async () => {
    const result = await handleImportRun(store, {});
    expect(result.status).toBe(400);
  });

  it("rejects events without a run_start", async () => {
    const result = await handleImportRun(store, { events: [] });
    expect(result.status).toBe(400);
  });

  it("imports a recorded session and writes to store", async () => {
    const result = await handleImportRun(store, {
      events: [
        {
          type: "run_start",
          runId: "run_import_1",
          branchId: "branch_import_1",
          nodeId: "n_root",
          parentNodeId: null,
          timestamp: "2026-05-15T10:00:00.000Z",
          attributes: { title: "Imported", userTask: "test import" },
        },
        {
          type: "policy_deny",
          runId: "run_import_1",
          branchId: "branch_import_1",
          nodeId: "n_deny",
          parentNodeId: "n_root",
          timestamp: "2026-05-15T10:00:01.000Z",
          attributes: {
            actionType: "file_read",
            decision: "deny",
            resource: "/private/keys",
            normalizedResource: "/private/**",
            policyRuleId: "rule_1",
            policyRuleText: "deny",
            policyPath: "files.deny_read[0]",
            reason: "match",
            actor: "openshell",
          },
        },
        {
          type: "run_end",
          runId: "run_import_1",
          branchId: "branch_import_1",
          nodeId: "n_end",
          parentNodeId: "n_deny",
          timestamp: "2026-05-15T10:00:02.000Z",
          attributes: { status: "failed" },
        },
      ],
    });
    expect(result.status).toBe(201);
    const b = body<{ runId: string; nodeCount: number; policyDecisionCount: number }>(result);
    expect(b.runId).toBe("run_import_1");
    expect(b.nodeCount).toBeGreaterThan(0);
    expect(b.policyDecisionCount).toBe(1);
    expect(await store.getRun("run_import_1")).toBeDefined();
    const run = await store.getRun("run_import_1");
    expect(run!.status).toBe("failed");
  });
});
