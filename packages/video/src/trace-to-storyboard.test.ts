import { describe, it, expect } from "vitest";
import { traceToStoryboard } from "./trace-to-storyboard";
import type { ExecutionNode } from "@nemocognition/core";

function node(overrides: Partial<ExecutionNode>): ExecutionNode {
  return {
    nodeId: "n1",
    runId: "run_1",
    branchId: "branch_1",
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
    ...overrides,
  };
}

describe("traceToStoryboard", () => {
  it("creates one scene per node in chronological order", () => {
    const sb = traceToStoryboard([
      node({ nodeId: "n1", title: "A", startedAt: "2026-05-15T10:00:00Z" }),
      node({ nodeId: "n2", title: "B", startedAt: "2026-05-15T10:00:01Z" }),
    ]);
    expect(sb.scenes).toHaveLength(2);
    expect(sb.scenes[0].nodeId).toBe("n1");
    expect(sb.scenes[1].nodeId).toBe("n2");
  });

  it("sums total duration", () => {
    const sb = traceToStoryboard([node({}), node({ nodeId: "n2" })]);
    expect(sb.totalDurationMs).toBeGreaterThan(0);
    expect(sb.totalDurationMs).toBe(sb.scenes.reduce((s, sc) => s + sc.durationMs, 0));
  });

  it("includes narration text per scene", () => {
    const sb = traceToStoryboard([node({ type: "policy_deny", summary: "Path denied" })]);
    expect(sb.scenes[0].narration).toContain("Path denied");
  });

  it("flags policy_deny scenes as climactic with longer duration", () => {
    const sb = traceToStoryboard([
      node({ nodeId: "n1", type: "agent_message" }),
      node({ nodeId: "n2", type: "policy_deny", summary: "Blocked" }),
    ]);
    const denyScene = sb.scenes.find((s) => s.nodeId === "n2")!;
    const agentScene = sb.scenes.find((s) => s.nodeId === "n1")!;
    expect(denyScene.isClimactic).toBe(true);
    expect(denyScene.durationMs).toBeGreaterThan(agentScene.durationMs);
  });

  it("includes overall metadata", () => {
    const sb = traceToStoryboard([node({})], { runId: "run_1", title: "Demo" });
    expect(sb.runId).toBe("run_1");
    expect(sb.title).toBe("Demo");
  });

  it("returns empty storyboard for no nodes", () => {
    const sb = traceToStoryboard([]);
    expect(sb.scenes).toEqual([]);
    expect(sb.totalDurationMs).toBe(0);
  });
});
