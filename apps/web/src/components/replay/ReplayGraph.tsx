"use client";

import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ExecutionNode } from "@nemocognition/core";

const NODE_ICONS: Record<string, string> = {
  agent_message: "◈",
  model_call: "◆",
  tool_call: "⬡",
  tool_result: "⬢",
  memory_update: "◉",
  file_diff: "≡",
  validation: "✓",
  failure: "✕",
  checkpoint: "⊙",
  branch_start: "⑂",
  human_correction: "✎",
  policy_allow: "✓",
  policy_deny: "⊘",
  audit_event: "◎",
  sandbox_violation: "⚠",
  file_access: "⊞",
  network_access: "⊕",
  command_execution: "▷",
  policy_misconfiguration: "⚙",
};

type ExecutionNodeData = Record<string, unknown> & {
  nodeId: string;
  type: string;
  status: string;
  title: string;
  summary: string;
  branchId: string;
  color: string;
  startedAt: string;
  endedAt: string | null;
  isActive: boolean;
  isSelected: boolean;
  isVisible: boolean;
};

function ExecutionNodeComponent({ data }: NodeProps<Node<ExecutionNodeData>>) {
  const opacity = data.isVisible ? 1 : 0.15;
  const scale = data.isActive ? 1.05 : 1;
  const ring = data.isSelected
    ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg)]"
    : data.isActive
    ? "ring-1 ring-white/30"
    : "";

  return (
    <div
      className={`relative transition-all duration-300 ${ring}`}
      style={{
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-0 !h-0" />
      <div
        className="rounded-lg border px-3 py-2 min-w-[200px] max-w-[260px]"
        style={{
          backgroundColor: `${data.color}15`,
          borderColor: `${data.color}50`,
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base" style={{ color: data.color }}>
            {NODE_ICONS[data.type] ?? "●"}
          </span>
          <span
            className="text-xs font-medium truncate"
            style={{ color: data.color }}
          >
            {data.title}
          </span>
        </div>
        <p className="text-[10px] text-[var(--color-text-muted)] line-clamp-2 leading-tight">
          {data.summary}
        </p>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-0 !h-0" />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  executionNode: ExecutionNodeComponent as any,
};

interface ReplayGraphProps {
  nodes: ExecutionNode[];
  activeIndex: number;
  selectedNodeId: string | null;
  onNodeClick: (nodeId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  success: "#22c55e",
  failure: "#ef4444",
  risky: "#eab308",
  memory: "#3b82f6",
  branch: "#a855f7",
};

export function ReplayGraph({ nodes, activeIndex, selectedNodeId, onNodeClick }: ReplayGraphProps) {

  const { flowNodes, flowEdges } = useMemo(() => {
    const branchIds = [...new Set(nodes.map((n) => n.branchId))];
    const branchX: Record<string, number> = {};
    branchIds.forEach((b, i) => {
      branchX[b] = i * 320;
    });

    const branchCounters: Record<string, number> = {};

    const flowNodes: Node<ExecutionNodeData>[] = nodes.map((node, idx) => {
      const bId = node.branchId;
      branchCounters[bId] = (branchCounters[bId] ?? 0) + 1;
      const yIdx = branchCounters[bId] - 1;

      return {
        id: node.nodeId,
        type: "executionNode",
        position: { x: branchX[bId] ?? 0, y: yIdx * 130 },
        data: {
          nodeId: node.nodeId,
          type: node.type,
          status: node.status,
          title: node.title,
          summary: node.summary,
          branchId: node.branchId,
          color: STATUS_COLORS[node.status] ?? "#888",
          startedAt: node.startedAt,
          endedAt: node.endedAt,
          isActive: idx === activeIndex,
          isSelected: node.nodeId === selectedNodeId,
          isVisible: activeIndex < 0 || idx <= activeIndex,
        },
      };
    });

    const flowEdges: Edge[] = nodes
      .filter((n) => n.parentNodeId)
      .map((n) => ({
        id: `e-${n.parentNodeId}-${n.nodeId}`,
        source: n.parentNodeId!,
        target: n.nodeId,
        animated: n.type === "branch_start",
        style: {
          stroke: n.branchId !== nodes.find((p) => p.nodeId === n.parentNodeId)?.branchId
            ? "#a855f7"
            : "#2a2a3a",
          strokeWidth: 2,
        },
      }));

    return { flowNodes, flowEdges };
  }, [nodes, activeIndex, selectedNodeId]);

  const handleNodeClick = useCallback(
    (_: any, node: Node) => {
      onNodeClick(node.id);
    },
    [onNodeClick]
  );

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        fitView
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1a1a26" gap={20} />
        <Controls
          className="!bg-[var(--color-bg-secondary)] !border-[var(--color-border)] !rounded-lg [&>button]:!bg-[var(--color-bg-secondary)] [&>button]:!border-[var(--color-border)] [&>button]:!text-[var(--color-text-muted)] [&>button:hover]:!bg-[var(--color-bg-tertiary)]"
        />
      </ReactFlow>
    </div>
  );
}
