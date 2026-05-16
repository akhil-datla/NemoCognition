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
  const opacity = data.isVisible ? 1 : 0.2;

  const isFailure = data.status === "failure";
  const isSuccess = data.status === "success";
  const isBranch = data.status === "branch";

  // Every status node carries its own tint at rest — completed → green,
  // failure → red, branch → violet — so the graph reads as a heat map of
  // outcomes. Neutral graphite is reserved for genuinely neutral types
  // (memory updates, risky-but-not-failed, etc.).
  const statusTinted = isSuccess || isFailure || isBranch;
  const tinted = statusTinted || data.isActive || data.isSelected;

  // The icon color always reflects the node's own status so a selected
  // failure stays red — green highlights never override a real status.
  const iconColor = isFailure
    ? "var(--color-failure)"
    : isSuccess
    ? "var(--color-success)"
    : isBranch
    ? "var(--color-branch)"
    : data.isActive || data.isSelected
    ? "var(--color-accent)"
    : "var(--color-text-subtle)";

  // Selection border: keep the status color for status-tinted nodes
  // (failure stays red, branch stays violet), use NVIDIA green only on
  // neutral nodes that have nothing else to say.
  const borderColor = data.isSelected
    ? statusTinted
      ? data.color
      : "var(--color-accent)"
    : tinted
    ? `${data.color}40`
    : "var(--color-border)";

  return (
    <div
      className="relative transition-opacity duration-200"
      style={{ opacity }}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-0 !h-0" />
      <div
        className="rounded-md px-3 py-2 min-w-[210px] max-w-[260px] transition-colors"
        style={{
          backgroundColor: tinted
            ? `${data.color}14`
            : "var(--color-bg-secondary)",
          borderWidth: data.isSelected ? 1.5 : 1,
          borderStyle: "solid",
          borderColor,
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm leading-none" style={{ color: iconColor }}>
            {NODE_ICONS[data.type] ?? "●"}
          </span>
          <span className="text-[12px] font-medium truncate text-[var(--color-text)]">
            {data.title}
          </span>
        </div>
        <p className="text-[11px] text-[var(--color-text-muted)] line-clamp-2 leading-snug">
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

// Graphite palette — mirror globals.css. Used by graph tints/borders.
const STATUS_COLORS: Record<string, string> = {
  success: "#76b900",
  failure: "#f87171",
  risky: "#f59e0b",
  memory: "#64a6ff",
  branch: "#a78bfa",
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
            ? "#a78bfa"
            : "rgba(255,255,255,0.12)",
          strokeWidth: 1.5,
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
        <Background color="rgba(255,255,255,0.05)" gap={32} size={1} />
        <Controls
          className="!bg-[var(--color-bg-secondary)] !border-[var(--color-border)] !rounded-md !shadow-none [&>button]:!bg-transparent [&>button]:!border-[var(--color-border)] [&>button]:!text-[var(--color-text-muted)] [&>button:hover]:!bg-white/5 [&>button:hover]:!text-[var(--color-text)]"
        />
      </ReactFlow>
    </div>
  );
}
