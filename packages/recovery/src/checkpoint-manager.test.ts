import { describe, it, expect } from "vitest";
import {
  CheckpointManager,
  type CheckpointStore,
  type CheckpointData,
} from "./checkpoint-manager";

function makeStore(): CheckpointStore & { data: Map<string, CheckpointData> } {
  const data = new Map<string, CheckpointData>();
  return {
    data,
    async save(checkpoint: CheckpointData) {
      data.set(checkpoint.id, checkpoint);
    },
    async load(id: string) {
      return data.get(id) ?? null;
    },
    async findByNode(runId: string, nodeId: string) {
      for (const cp of data.values()) {
        if (cp.runId === runId && cp.nodeId === nodeId) return cp;
      }
      return null;
    },
    async findNearest(runId: string, branchId: string, beforeNodeId: string) {
      const candidates = [...data.values()].filter(
        cp => cp.runId === runId && cp.branchId === branchId
      );
      return candidates[candidates.length - 1] ?? null;
    },
  };
}

describe("CheckpointManager", () => {
  it("creates a checkpoint with all required fields", async () => {
    const store = makeStore();
    const mgr = new CheckpointManager(store);
    const cp = await mgr.create({
      runId: "run_1",
      nodeId: "node_3",
      branchId: "branch_main",
      memory: { key: "value" },
      context: { messages: [] },
      prompt: "Do the task",
      policyYaml: "files:\n  allow_read:\n    - ./research/**",
    });
    expect(cp.id).toBeTruthy();
    expect(cp.runId).toBe("run_1");
    expect(cp.nodeId).toBe("node_3");
    expect(cp.branchId).toBe("branch_main");
    expect(cp.memory).toEqual({ key: "value" });
    expect(cp.policyYaml).toContain("allow_read");
  });

  it("loads a saved checkpoint", async () => {
    const store = makeStore();
    const mgr = new CheckpointManager(store);
    const cp = await mgr.create({ runId: "run_1", nodeId: "n1", branchId: "b1" });
    const loaded = await mgr.load(cp.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(cp.id);
  });

  it("finds nearest checkpoint for a branch", async () => {
    const store = makeStore();
    const mgr = new CheckpointManager(store);
    await mgr.create({ runId: "run_1", nodeId: "n1", branchId: "branch_main" });
    await mgr.create({ runId: "run_1", nodeId: "n3", branchId: "branch_main" });
    const nearest = await mgr.findNearest("run_1", "branch_main", "n5");
    expect(nearest).not.toBeNull();
    expect(nearest!.nodeId).toBe("n3");
  });

  it("returns null for unknown checkpoint", async () => {
    const store = makeStore();
    const mgr = new CheckpointManager(store);
    const loaded = await mgr.load("nonexistent");
    expect(loaded).toBeNull();
  });
});
