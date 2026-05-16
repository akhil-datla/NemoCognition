import type { ExecutionNode, PolicyDecisionEvent, AllNodeType, NodeStatus } from "@nemocognition/core";

/**
 * Minimal client-safe ingestor: converts a single SSE tracker event into the
 * shape ReplayGraph/NodeInspector expect. Mirrors the relevant cases of the
 * server-side trace-ingestor without pulling in any node:crypto deps.
 */

interface IncomingEvent {
  type: string;
  runId?: string;
  branchId?: string;
  nodeId?: string;
  parentNodeId?: string | null;
  timestamp?: string;
  attributes?: Record<string, unknown>;
  // RunnerControlEvent variants:
  status?: string;
  message?: string;
}

export interface IngestedDelta {
  nodes: ExecutionNode[];
  policyEvents: PolicyDecisionEvent[];
  /** Indicates a terminal event so subscribers can close the stream. */
  isComplete: boolean;
}

function makeNode(
  ev: IncomingEvent,
  type: AllNodeType,
  status: NodeStatus,
  title: string,
  summary: string,
): ExecutionNode {
  return {
    nodeId: ev.nodeId ?? "",
    runId: ev.runId ?? "",
    branchId: ev.branchId ?? "",
    parentNodeId: ev.parentNodeId ?? null,
    checkpointId: null,
    type,
    status,
    title,
    summary,
    startedAt: ev.timestamp ?? new Date().toISOString(),
    endedAt: null,
    payload: (ev.attributes ?? null) as ExecutionNode["payload"],
    payloadRef: null,
    validationRef: null,
  };
}

function policyEvent(ev: IncomingEvent, decision: "allow" | "deny"): PolicyDecisionEvent {
  const a = ev.attributes ?? {};
  return {
    eventId: `pde_${ev.nodeId ?? Math.random().toString(36).slice(2)}`,
    runId: ev.runId ?? "",
    branchId: ev.branchId ?? "",
    nodeId: ev.nodeId ?? "",
    parentNodeId: ev.parentNodeId ?? null,
    checkpointId: null,
    actionType: String(a.actionType ?? "tool_execution") as PolicyDecisionEvent["actionType"],
    decision,
    resource: String(a.resource ?? ""),
    normalizedResource: String(a.normalizedResource ?? ""),
    policyRuleId: String(a.policyRuleId ?? ""),
    policyRuleText: String(a.policyRuleText ?? ""),
    policyPath: String(a.policyPath ?? ""),
    reason: String(a.reason ?? ""),
    actor: (a.actor as PolicyDecisionEvent["actor"]) ?? "nemoclaw_agent",
    auditLogRef: `audit/${ev.runId}/${ev.nodeId}`,
    timestamp: ev.timestamp ?? new Date().toISOString(),
    rawPayloadRef: `payload/${ev.nodeId}`,
  };
}

export function ingestClientEvent(ev: IncomingEvent): IngestedDelta {
  const delta: IngestedDelta = { nodes: [], policyEvents: [], isComplete: false };
  switch (ev.type) {
    case "run_start":
      delta.nodes.push(makeNode(ev, "agent_message", "success", "Run started", String(ev.attributes?.userTask ?? "")));
      break;
    case "model_call_end":
      delta.nodes.push(makeNode(ev, "model_call", "success", "Nemotron model call", ""));
      break;
    case "tool_call_end": {
      const exitCode = Number(ev.attributes?.exitCode ?? 0);
      const status: NodeStatus = exitCode === 0 ? "success" : "failure";
      const errClass = ev.attributes?.errorClass ? ` (${ev.attributes.errorClass})` : "";
      delta.nodes.push(makeNode(ev, "tool_call", status, "Tool call", `exit=${exitCode}${errClass}`));
      break;
    }
    case "policy_allow":
      delta.nodes.push(makeNode(ev, "policy_allow", "success", `Allowed: ${ev.attributes?.resource ?? ""}`, String(ev.attributes?.reason ?? "")));
      delta.policyEvents.push(policyEvent(ev, "allow"));
      break;
    case "policy_deny":
      delta.nodes.push(makeNode(ev, "policy_deny", "failure", `Denied: ${ev.attributes?.resource ?? ""}`, String(ev.attributes?.reason ?? "")));
      delta.policyEvents.push(policyEvent(ev, "deny"));
      break;
    case "checkpoint": {
      const cpId = String(ev.attributes?.checkpointId ?? ev.nodeId ?? "");
      delta.nodes.push(makeNode(ev, "checkpoint", "success", "Checkpoint", `Checkpoint ${cpId}`));
      break;
    }
    case "memory_update":
      delta.nodes.push(makeNode(ev, "memory_update", "memory", "Memory update", String(ev.attributes?.key ?? "memory")));
      break;
    case "file_diff":
      delta.nodes.push(makeNode(ev, "file_diff", "success", "File diff", String(ev.attributes?.path ?? "")));
      break;
    case "validation": {
      const passed = ev.attributes?.status === "pass";
      delta.nodes.push(makeNode(ev, "validation", passed ? "success" : "failure", "Validation", String(ev.attributes?.status ?? "")));
      break;
    }
    case "complete":
      delta.isComplete = true;
      break;
    // model_call_start, tool_call_start, run_end, error: skipped (no node)
  }
  return delta;
}
