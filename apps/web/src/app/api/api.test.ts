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
} from "./handlers";

let store: InMemoryStore;

beforeEach(() => {
  store = new InMemoryStore();
});

describe("POST /api/runs", () => {
  it("creates a run with valid input", () => {
    const result = handleCreateRun(store, {
      title: "Research report",
      userTask: "Create a report from research docs",
    });
    expect(result.status).toBe(201);
    expect(result.body.id).toBeTruthy();
    expect(result.body.status).toBe("pending");
    expect(result.body.rootBranchId).toBeTruthy();
  });

  it("rejects empty title", () => {
    const result = handleCreateRun(store, { title: "", userTask: "task" });
    expect(result.status).toBe(400);
  });
});

describe("GET /api/runs/:runId", () => {
  it("returns a run by ID", () => {
    const created = handleCreateRun(store, { title: "Test", userTask: "task" });
    const result = handleGetRun(store, created.body.id);
    expect(result.status).toBe(200);
    expect(result.body.id).toBe(created.body.id);
  });

  it("returns 404 for unknown run", () => {
    const result = handleGetRun(store, "nonexistent");
    expect(result.status).toBe(404);
  });
});

describe("GET /api/runs/:runId/graph", () => {
  it("returns empty graph for run with no nodes", () => {
    const created = handleCreateRun(store, { title: "Test", userTask: "task" });
    const result = handleGetGraph(store, created.body.id);
    expect(result.status).toBe(200);
    expect(result.body.nodes).toEqual([]);
    expect(result.body.edges).toEqual([]);
  });

  it("returns graph with nodes", () => {
    const created = handleCreateRun(store, { title: "Test", userTask: "task" });
    store.nodes.set("n1", {
      nodeId: "n1",
      runId: created.body.id,
      branchId: created.body.rootBranchId,
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
    const result = handleGetGraph(store, created.body.id);
    expect(result.body.nodes).toHaveLength(1);
  });
});

describe("GET /api/runs/:runId/nodes/:nodeId", () => {
  it("returns a node by ID", () => {
    const created = handleCreateRun(store, { title: "Test", userTask: "task" });
    store.nodes.set("n1", {
      nodeId: "n1",
      runId: created.body.id,
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
    const result = handleGetNode(store, created.body.id, "n1");
    expect(result.status).toBe(200);
    expect(result.body.nodeId).toBe("n1");
  });

  it("returns 404 for unknown node", () => {
    const created = handleCreateRun(store, { title: "Test", userTask: "task" });
    const result = handleGetNode(store, created.body.id, "nope");
    expect(result.status).toBe(404);
  });
});

describe("POST /api/runs/:runId/branches", () => {
  it("creates a branch", () => {
    const created = handleCreateRun(store, { title: "Test", userTask: "task" });
    const result = handleCreateBranch(store, created.body.id, {
      forkNodeId: "n3",
      correctionSummary: "Fix the issue",
    });
    expect(result.status).toBe(201);
    expect(result.body.id).toBeTruthy();
    expect(result.body.forkNodeId).toBe("n3");
  });
});

describe("POST /api/runs/:runId/fix-and-rerun", () => {
  it("creates a recovery branch and correction nodes", () => {
    const created = handleCreateRun(store, { title: "Test", userTask: "task" });
    const result = handleFixAndRerun(store, created.body.id, {
      failedNodeId: "n5",
      checkpointId: "cp_1",
      humanCorrection: "Avoid private files",
      recoveryStrategy: "replan_within_policy",
    });
    expect(result.status).toBe(201);
    expect(result.body.newBranchId).toBeTruthy();
    expect(result.body.correctionPrompt).toContain("cp_1");
  });
});

describe("POST /api/runs/:runId/video", () => {
  it("queues a video job", () => {
    const created = handleCreateRun(store, { title: "Test", userTask: "task" });
    const result = handleCreateVideo(store, created.body.id);
    expect(result.status).toBe(201);
    expect(result.body.status).toBe("pending");
  });
});

describe("GET /api/runs/:runId/video/:jobId", () => {
  it("returns video job status", () => {
    const created = handleCreateRun(store, { title: "Test", userTask: "task" });
    const videoResult = handleCreateVideo(store, created.body.id);
    const result = handleGetVideoJob(store, created.body.id, videoResult.body.id);
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("pending");
  });

  it("returns 404 for unknown job", () => {
    const created = handleCreateRun(store, { title: "Test", userTask: "task" });
    const result = handleGetVideoJob(store, created.body.id, "nope");
    expect(result.status).toBe(404);
  });
});

describe("GET /api/runs/:runId/policy", () => {
  it("returns policy decisions for a run", () => {
    const created = handleCreateRun(store, { title: "Test", userTask: "task" });
    const result = handleGetRunPolicy(store, created.body.id);
    expect(result.status).toBe(200);
    expect(result.body.decisions).toEqual([]);
  });
});

describe("GET /api/runs/:runId/audit", () => {
  it("returns audit events for a run", () => {
    const created = handleCreateRun(store, { title: "Test", userTask: "task" });
    const result = handleGetRunAudit(store, created.body.id);
    expect(result.status).toBe(200);
    expect(result.body.events).toEqual([]);
  });
});
