import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore } from "@nemocognition/db";
import { processPendingVideoJobs } from "./video-jobs";
import type { ExecutionNode, VideoJob, Run } from "@nemocognition/core";

function makeRun(id: string): Run {
  return {
    id,
    title: "Test",
    userTask: "task",
    status: "completed",
    createdAt: "2026-05-15T10:00:00Z",
    completedAt: null,
    rootBranchId: "b1",
  };
}

function makeNode(runId: string, nodeId: string): ExecutionNode {
  return {
    nodeId,
    runId,
    branchId: "b1",
    parentNodeId: null,
    checkpointId: null,
    type: "agent_message",
    status: "success",
    title: nodeId,
    summary: "n",
    startedAt: "2026-05-15T10:00:00Z",
    endedAt: null,
    payloadRef: null,
    validationRef: null,
  };
}

function makeJob(runId: string, jobId: string): VideoJob {
  return {
    id: jobId,
    runId,
    status: "pending",
    inputTraceRef: `phoenix/trace/${runId}`,
    outputVideoRef: null,
    createdAt: "2026-05-15T10:00:00Z",
    completedAt: null,
  };
}

describe("processPendingVideoJobs", () => {
  let store: InMemoryStore;
  beforeEach(() => {
    store = new InMemoryStore();
  });

  it("processes a pending job and marks it completed", async () => {
    await store.setRun(makeRun("run_1"));
    await store.setNode(makeNode("run_1", "n1"));
    await store.setVideoJob(makeJob("run_1", "vj_1"));

    const result = await processPendingVideoJobs(store);
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);

    const job = await store.getVideoJob("vj_1");
    expect(job!.status).toBe("completed");
    expect(job!.outputVideoRef).toBeTruthy();
    expect(job!.completedAt).toBeTruthy();
  });

  it("returns processed:0 when no pending jobs", async () => {
    const result = await processPendingVideoJobs(store);
    expect(result.processed).toBe(0);
  });

  it("marks job failed when run is missing", async () => {
    await store.setVideoJob(makeJob("run_missing", "vj_2"));
    const result = await processPendingVideoJobs(store);
    expect(result.failed).toBe(1);
    const job = await store.getVideoJob("vj_2");
    expect(job!.status).toBe("failed");
  });

  it("processes multiple pending jobs in a single tick", async () => {
    await store.setRun(makeRun("run_a"));
    await store.setNode(makeNode("run_a", "n1"));
    await store.setRun(makeRun("run_b"));
    await store.setNode(makeNode("run_b", "n2"));
    await store.setVideoJob(makeJob("run_a", "vj_a"));
    await store.setVideoJob(makeJob("run_b", "vj_b"));

    const result = await processPendingVideoJobs(store);
    expect(result.processed).toBe(2);
  });
});
