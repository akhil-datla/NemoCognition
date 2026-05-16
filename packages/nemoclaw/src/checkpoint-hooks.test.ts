import { describe, it, expect, beforeEach } from "vitest";
import { CheckpointHooks, type CheckpointData } from "./checkpoint-hooks";

describe("CheckpointHooks", () => {
  let hooks: CheckpointHooks;

  beforeEach(() => {
    hooks = new CheckpointHooks();
  });

  it("creates a checkpoint with all required fields", () => {
    const cp = hooks.create({
      runId: "run_1",
      nodeId: "node_5",
      branchId: "branch_1",
      memory: { findings: "scaling laws" },
      context: { step: 3 },
      prompt: "Continue research",
      policyYaml: "files:\n  allow_read:\n    - ./research/**",
    });

    expect(cp.id).toBeTruthy();
    expect(cp.runId).toBe("run_1");
    expect(cp.nodeId).toBe("node_5");
    expect(cp.branchId).toBe("branch_1");
    expect(cp.memory).toEqual({ findings: "scaling laws" });
    expect(cp.policyYaml).toContain("allow_read");
    expect(cp.createdAt).toBeTruthy();
  });

  it("loads a checkpoint by ID", () => {
    const cp = hooks.create({
      runId: "run_1",
      nodeId: "node_5",
      branchId: "branch_1",
      memory: {},
      context: {},
      prompt: "test",
      policyYaml: "",
    });

    const loaded = hooks.load(cp.id);
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe(cp.id);
  });

  it("returns null for unknown checkpoint", () => {
    expect(hooks.load("nonexistent")).toBeNull();
  });

  it("finds checkpoint by node ID", () => {
    hooks.create({
      runId: "run_1",
      nodeId: "node_5",
      branchId: "branch_1",
      memory: {},
      context: {},
      prompt: "test",
      policyYaml: "",
    });

    const found = hooks.findByNode("node_5");
    expect(found).toBeDefined();
    expect(found!.nodeId).toBe("node_5");
  });

  it("finds nearest checkpoint walking up from a node", () => {
    const cp1 = hooks.create({
      runId: "run_1",
      nodeId: "node_3",
      branchId: "branch_1",
      memory: { step: 1 },
      context: {},
      prompt: "step 1",
      policyYaml: "",
    });

    const cp2 = hooks.create({
      runId: "run_1",
      nodeId: "node_7",
      branchId: "branch_1",
      memory: { step: 2 },
      context: {},
      prompt: "step 2",
      policyYaml: "",
    });

    const nearest = hooks.findNearest("run_1", "branch_1");
    expect(nearest).toBeDefined();
    expect(nearest!.id).toBe(cp2.id);
  });

  it("lists all checkpoints for a run", () => {
    hooks.create({ runId: "run_1", nodeId: "n1", branchId: "b1", memory: {}, context: {}, prompt: "", policyYaml: "" });
    hooks.create({ runId: "run_1", nodeId: "n2", branchId: "b1", memory: {}, context: {}, prompt: "", policyYaml: "" });
    hooks.create({ runId: "run_2", nodeId: "n3", branchId: "b2", memory: {}, context: {}, prompt: "", policyYaml: "" });

    const forRun1 = hooks.listByRun("run_1");
    expect(forRun1).toHaveLength(2);
  });
});
