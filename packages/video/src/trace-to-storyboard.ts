import type { ExecutionNode, AllNodeType } from "@nemocognition/core";

export interface Scene {
  nodeId: string;
  index: number;
  type: AllNodeType;
  title: string;
  narration: string;
  durationMs: number;
  isClimactic: boolean;
}

export interface Storyboard {
  runId: string;
  title: string;
  scenes: Scene[];
  totalDurationMs: number;
}

export interface StoryboardOptions {
  runId?: string;
  title?: string;
}

const DEFAULT_DURATION_MS = 2500;
const CLIMACTIC_DURATION_MS = 6000;
const CLIMACTIC_TYPES: AllNodeType[] = ["policy_deny", "sandbox_violation", "failure"];

export function traceToStoryboard(
  nodes: ExecutionNode[],
  options: StoryboardOptions = {},
): Storyboard {
  const sorted = [...nodes].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  const scenes: Scene[] = sorted.map((node, index) => {
    const isClimactic = CLIMACTIC_TYPES.includes(node.type) || node.status === "failure";
    return {
      nodeId: node.nodeId,
      index,
      type: node.type,
      title: node.title,
      narration: buildNarration(node),
      durationMs: isClimactic ? CLIMACTIC_DURATION_MS : DEFAULT_DURATION_MS,
      isClimactic,
    };
  });

  return {
    runId: options.runId ?? nodes[0]?.runId ?? "",
    title: options.title ?? "",
    scenes,
    totalDurationMs: scenes.reduce((sum, s) => sum + s.durationMs, 0),
  };
}

function buildNarration(node: ExecutionNode): string {
  switch (node.type) {
    case "model_call":
      return `The Nemotron model reasoned. ${node.summary}`;
    case "tool_call":
      return `The agent invoked ${node.title}. ${node.summary}`;
    case "policy_allow":
      return `OpenShell allowed the action. ${node.summary}`;
    case "policy_deny":
      return `OpenShell blocked an unsafe action. ${node.summary}`;
    case "checkpoint":
      return `A checkpoint was taken. ${node.summary}`;
    case "memory_update":
      return `The agent updated its memory. ${node.summary}`;
    case "branch_start":
      return `A recovery branch began. ${node.summary}`;
    case "human_correction":
      return `A human correction was applied. ${node.summary}`;
    case "validation":
      return `Validation result: ${node.status}. ${node.summary}`;
    default:
      return `${node.title}. ${node.summary}`;
  }
}
