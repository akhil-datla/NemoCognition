import { describe, it, expect } from "vitest";
import { buildExecutionGraph, type ExecutionGraph } from "./graph-builder";
import type { ExecutionNode } from "../schemas";

function makeNode(overrides: Partial<ExecutionNode> & { nodeId: string }): ExecutionNode {
  return {
    runId: "run_1",
    branchId: "branch_main",
    parentNodeId: null,
    checkpointId: null,
    type: "tool_call",
    status: "success",
    title: "Test node",
    summary: "Test",
    startedAt: "2026-05-15T10:00:00Z",
    endedAt: "2026-05-15T10:00:01Z",
    payloadRef: null,
    validationRef: null,
    ...overrides,
  };
}

describe("buildExecutionGraph", () => {
  it("builds a graph from ordered nodes", () => {
    const nodes: ExecutionNode[] = [
      makeNode({ nodeId: "n1", parentNodeId: null, type: "agent_message" }),
      makeNode({ nodeId: "n2", parentNodeId: "n1", type: "model_call" }),
      makeNode({ nodeId: "n3", parentNodeId: "n2", type: "tool_call" }),
    ];
    const graph = buildExecutionGraph(nodes);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toEqual({ source: "n1", target: "n2" });
    expect(graph.edges[1]).toEqual({ source: "n2", target: "n3" });
  });

  it("builds a graph from unordered nodes", () => {
    const nodes: ExecutionNode[] = [
      makeNode({ nodeId: "n3", parentNodeId: "n2", type: "tool_call" }),
      makeNode({ nodeId: "n1", parentNodeId: null, type: "agent_message" }),
      makeNode({ nodeId: "n2", parentNodeId: "n1", type: "model_call" }),
    ];
    const graph = buildExecutionGraph(nodes);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
  });

  it("preserves failed path when recovery branch exists", () => {
    const nodes: ExecutionNode[] = [
      makeNode({ nodeId: "n1", parentNodeId: null }),
      makeNode({ nodeId: "n2", parentNodeId: "n1" }),
      makeNode({ nodeId: "n3", parentNodeId: "n2", status: "failure", type: "failure" }),
      makeNode({ nodeId: "n4", parentNodeId: "n2", branchId: "branch_recovery", type: "branch_start", status: "branch" }),
      makeNode({ nodeId: "n5", parentNodeId: "n4", branchId: "branch_recovery", status: "success" }),
    ];
    const graph = buildExecutionGraph(nodes);
    expect(graph.nodes).toHaveLength(5);
    const failedNode = graph.nodes.find(n => n.id === "n3");
    expect(failedNode?.data.status).toBe("failure");
    const branchNode = graph.nodes.find(n => n.id === "n4");
    expect(branchNode?.data.status).toBe("branch");
  });

  it("branch nodes link back to fork parent", () => {
    const nodes: ExecutionNode[] = [
      makeNode({ nodeId: "n1", parentNodeId: null }),
      makeNode({ nodeId: "n2", parentNodeId: "n1", status: "failure" }),
      makeNode({ nodeId: "n3", parentNodeId: "n1", branchId: "branch_r", type: "branch_start", status: "branch", checkpointId: "cp_1" }),
    ];
    const graph = buildExecutionGraph(nodes);
    const edgeFromFork = graph.edges.find(e => e.source === "n1" && e.target === "n3");
    expect(edgeFromFork).toBeDefined();
  });

  it("returns empty graph for empty input", () => {
    const graph = buildExecutionGraph([]);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it("assigns correct colors based on status", () => {
    const nodes: ExecutionNode[] = [
      makeNode({ nodeId: "n1", status: "success" }),
      makeNode({ nodeId: "n2", parentNodeId: "n1", status: "failure" }),
      makeNode({ nodeId: "n3", parentNodeId: "n1", status: "risky" }),
      makeNode({ nodeId: "n4", parentNodeId: "n1", status: "memory" }),
      makeNode({ nodeId: "n5", parentNodeId: "n1", status: "branch" }),
    ];
    const graph = buildExecutionGraph(nodes);
    expect(graph.nodes.find(n => n.id === "n1")?.data.color).toBe("#22c55e");
    expect(graph.nodes.find(n => n.id === "n2")?.data.color).toBe("#ef4444");
    expect(graph.nodes.find(n => n.id === "n3")?.data.color).toBe("#eab308");
    expect(graph.nodes.find(n => n.id === "n4")?.data.color).toBe("#3b82f6");
    expect(graph.nodes.find(n => n.id === "n5")?.data.color).toBe("#a855f7");
  });

  it("includes policy nodes in graph", () => {
    const nodes: ExecutionNode[] = [
      makeNode({ nodeId: "n1", parentNodeId: null }),
      makeNode({ nodeId: "n2", parentNodeId: "n1", type: "policy_allow", status: "success" }),
      makeNode({ nodeId: "n3", parentNodeId: "n2", type: "policy_deny", status: "failure" }),
    ];
    const graph = buildExecutionGraph(nodes);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.find(n => n.id === "n2")?.data.type).toBe("policy_allow");
    expect(graph.nodes.find(n => n.id === "n3")?.data.type).toBe("policy_deny");
  });

  it("produces unique branch IDs in graph metadata", () => {
    const nodes: ExecutionNode[] = [
      makeNode({ nodeId: "n1", branchId: "branch_main" }),
      makeNode({ nodeId: "n2", parentNodeId: "n1", branchId: "branch_main" }),
      makeNode({ nodeId: "n3", parentNodeId: "n1", branchId: "branch_recovery" }),
    ];
    const graph = buildExecutionGraph(nodes);
    expect(graph.branches).toEqual(["branch_main", "branch_recovery"]);
  });
});
