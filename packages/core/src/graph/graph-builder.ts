import type { ExecutionNode, AllNodeType, NodeStatus } from "../schemas";

export interface GraphNode {
  id: string;
  position: { x: number; y: number };
  data: {
    nodeId: string;
    type: AllNodeType;
    status: NodeStatus;
    title: string;
    summary: string;
    branchId: string;
    color: string;
    startedAt: string;
    endedAt: string | null;
  };
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface ExecutionGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  branches: string[];
}

const STATUS_COLORS: Record<NodeStatus, string> = {
  success: "#22c55e",
  failure: "#ef4444",
  risky: "#eab308",
  memory: "#3b82f6",
  branch: "#a855f7",
};

export function buildExecutionGraph(executionNodes: ExecutionNode[]): ExecutionGraph {
  if (executionNodes.length === 0) {
    return { nodes: [], edges: [], branches: [] };
  }

  const nodeMap = new Map<string, ExecutionNode>();
  for (const node of executionNodes) {
    nodeMap.set(node.nodeId, node);
  }

  const branches = [...new Set(executionNodes.map(n => n.branchId))];

  const branchIndex = new Map<string, number>();
  branches.forEach((b, i) => branchIndex.set(b, i));

  const childrenByParent = new Map<string, string[]>();
  for (const node of executionNodes) {
    if (node.parentNodeId) {
      const children = childrenByParent.get(node.parentNodeId) ?? [];
      children.push(node.nodeId);
      childrenByParent.set(node.parentNodeId, children);
    }
  }

  const roots = executionNodes.filter(n => !n.parentNodeId);
  const visited = new Set<string>();
  const orderedIds: string[] = [];

  function dfs(nodeId: string) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    orderedIds.push(nodeId);
    const children = childrenByParent.get(nodeId) ?? [];
    for (const childId of children) {
      dfs(childId);
    }
  }

  for (const root of roots) {
    dfs(root.nodeId);
  }

  for (const node of executionNodes) {
    if (!visited.has(node.nodeId)) {
      orderedIds.push(node.nodeId);
    }
  }

  const graphNodes: GraphNode[] = orderedIds.map((id, idx) => {
    const node = nodeMap.get(id)!;
    const bIdx = branchIndex.get(node.branchId) ?? 0;
    return {
      id: node.nodeId,
      position: { x: bIdx * 300, y: idx * 120 },
      data: {
        nodeId: node.nodeId,
        type: node.type,
        status: node.status,
        title: node.title,
        summary: node.summary,
        branchId: node.branchId,
        color: STATUS_COLORS[node.status],
        startedAt: node.startedAt,
        endedAt: node.endedAt,
      },
    };
  });

  const edges: GraphEdge[] = [];
  for (const node of executionNodes) {
    if (node.parentNodeId && nodeMap.has(node.parentNodeId)) {
      edges.push({ source: node.parentNodeId, target: node.nodeId });
    }
  }

  return { nodes: graphNodes, edges, branches };
}
