import { describe, it, expect } from "vitest";
import { ingestTrackerEvents } from "./trace-ingestor";
import type { TrackerEvent } from "@nemocognition/nemoclaw";

function evt(overrides: Partial<TrackerEvent>): TrackerEvent {
  return {
    type: "run_start",
    runId: "run_1",
    branchId: "branch_1",
    nodeId: "n1",
    parentNodeId: null,
    timestamp: "2026-05-15T10:00:00.000Z",
    attributes: {},
    ...overrides,
  };
}

describe("ingestTrackerEvents", () => {
  it("produces a Run from run_start", () => {
    const result = ingestTrackerEvents([
      evt({ type: "run_start", attributes: { title: "Test", userTask: "do thing" } }),
    ]);
    expect(result.run).toBeDefined();
    expect(result.run!.id).toBe("run_1");
    expect(result.run!.title).toBe("Test");
    expect(result.run!.userTask).toBe("do thing");
    expect(result.run!.rootBranchId).toBe("branch_1");
    expect(result.run!.status).toBe("running");
  });

  it("marks run as completed on run_end with completed status", () => {
    const result = ingestTrackerEvents([
      evt({ type: "run_start", attributes: { title: "T", userTask: "t" } }),
      evt({ type: "run_end", nodeId: "n2", parentNodeId: "n1", attributes: { status: "completed" } }),
    ]);
    expect(result.run!.status).toBe("completed");
    expect(result.run!.completedAt).toBeTruthy();
  });

  it("creates a root Branch from run_start", () => {
    const result = ingestTrackerEvents([
      evt({ type: "run_start", attributes: { title: "T", userTask: "t" } }),
    ]);
    expect(result.branches).toHaveLength(1);
    expect(result.branches[0].id).toBe("branch_1");
    expect(result.branches[0].parentBranchId).toBeNull();
  });

  it("converts model_call_start/end into a model_call ExecutionNode", () => {
    const result = ingestTrackerEvents([
      evt({ type: "run_start", attributes: { title: "T", userTask: "t" } }),
      evt({ type: "model_call_start", nodeId: "mc1", parentNodeId: "n1", attributes: { promptRef: "p" } }),
      evt({ type: "model_call_end", nodeId: "mc1_end", parentNodeId: "mc1", attributes: { callId: "mc1", tokenCount: { input: 10, output: 5 }, latencyMs: 100 } }),
    ]);
    const modelNode = result.nodes.find((n) => n.type === "model_call");
    expect(modelNode).toBeDefined();
    expect(modelNode!.status).toBe("success");
    expect(modelNode!.endedAt).toBeTruthy();
  });

  it("converts tool_call_start/end into a tool_call ExecutionNode", () => {
    const result = ingestTrackerEvents([
      evt({ type: "run_start", attributes: { title: "T", userTask: "t" } }),
      evt({ type: "tool_call_start", nodeId: "tc1", parentNodeId: "n1", attributes: { toolName: "read_file", inputJson: "{}" } }),
      evt({ type: "tool_call_end", nodeId: "tc1_end", parentNodeId: "tc1", attributes: { callId: "tc1", exitCode: 0, durationMs: 50, errorClass: null, filesTouched: [] } }),
    ]);
    const toolNode = result.nodes.find((n) => n.type === "tool_call");
    expect(toolNode).toBeDefined();
    expect(toolNode!.title).toContain("read_file");
  });

  it("marks tool_call as failure when exitCode != 0", () => {
    const result = ingestTrackerEvents([
      evt({ type: "run_start", attributes: { title: "T", userTask: "t" } }),
      evt({ type: "tool_call_start", nodeId: "tc1", parentNodeId: "n1", attributes: { toolName: "rm", inputJson: "{}" } }),
      evt({ type: "tool_call_end", nodeId: "tc1_end", parentNodeId: "tc1", attributes: { callId: "tc1", exitCode: 1, durationMs: 5, errorClass: "PermissionDenied", filesTouched: [] } }),
    ]);
    const toolNode = result.nodes.find((n) => n.type === "tool_call");
    expect(toolNode!.status).toBe("failure");
  });

  it("emits policy_allow and policy_deny ExecutionNodes and PolicyDecisionEvents", () => {
    const result = ingestTrackerEvents([
      evt({ type: "run_start", attributes: { title: "T", userTask: "t" } }),
      evt({ type: "policy_deny", nodeId: "p1", parentNodeId: "n1", attributes: {
        actionType: "file_read",
        decision: "deny",
        resource: "./private/keys.txt",
        normalizedResource: "./private/**",
        policyRuleId: "rule_1",
        policyRuleText: "deny",
        policyPath: "files.deny_read[0]",
        reason: "match",
        actor: "openshell",
      } }),
    ]);
    const policyNode = result.nodes.find((n) => n.type === "policy_deny");
    expect(policyNode).toBeDefined();
    expect(policyNode!.status).toBe("failure");
    expect(result.policyDecisions).toHaveLength(1);
    expect(result.policyDecisions[0].decision).toBe("deny");
  });

  it("emits checkpoint ExecutionNodes and Checkpoint records", () => {
    const result = ingestTrackerEvents([
      evt({ type: "run_start", attributes: { title: "T", userTask: "t" } }),
      evt({ type: "checkpoint", nodeId: "cp_node", parentNodeId: "n1", attributes: { checkpointId: "cp_1" } }),
    ]);
    const cpNode = result.nodes.find((n) => n.type === "checkpoint");
    expect(cpNode).toBeDefined();
    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0].id).toBe("cp_1");
  });

  it("persists memory and policyYaml on the Checkpoint from the event attributes", () => {
    const result = ingestTrackerEvents([
      evt({ type: "run_start", attributes: { title: "T", userTask: "t" } }),
      evt({
        type: "checkpoint",
        nodeId: "cp_node",
        parentNodeId: "n1",
        attributes: {
          checkpointId: "cp_2",
          memory: { findings: "scaling laws", step: 3 },
          policyYaml: "files:\n  allow_read:\n    - ./research/**",
        },
      }),
    ]);
    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0].memoryJson).toEqual({ findings: "scaling laws", step: 3 });
    expect(result.checkpoints[0].policyYaml).toContain("allow_read");
  });

  it("emits validation nodes with appropriate status", () => {
    const result = ingestTrackerEvents([
      evt({ type: "run_start", attributes: { title: "T", userTask: "t" } }),
      evt({ type: "validation", nodeId: "v1", parentNodeId: "n1", attributes: { status: "pass", evidence: [] } }),
      evt({ type: "validation", nodeId: "v2", parentNodeId: "v1", attributes: { status: "fail", evidence: [] } }),
    ]);
    const valNodes = result.nodes.filter((n) => n.type === "validation");
    expect(valNodes).toHaveLength(2);
    expect(valNodes[0].status).toBe("success");
    expect(valNodes[1].status).toBe("failure");
  });

  it("handles empty event list", () => {
    const result = ingestTrackerEvents([]);
    expect(result.run).toBeNull();
    expect(result.nodes).toEqual([]);
    expect(result.branches).toEqual([]);
  });
});
