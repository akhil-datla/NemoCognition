import { z } from "zod";
import type { ExecutionNode, AllNodeType, NodeStatus } from "@nemocognition/core";

const spanInputSchema = z.object({
  runId: z.string().min(1),
  branchId: z.string().min(1),
  nodeId: z.string().min(1),
  parentNodeId: z.string().nullable(),
  checkpointId: z.string().nullable(),
  provider: z.literal("nvidia"),
  model: z.literal("nemotron"),
  spanKind: z.enum(["agent", "llm", "tool", "chain", "event"]),
  name: z.string(),
  startTime: z.string(),
  endTime: z.string().nullable(),
  status: z.enum(["ok", "error", "unset"]),
  payloadRef: z.string().nullable(),
  validationRef: z.string().nullable(),
});
export type SpanInput = z.infer<typeof spanInputSchema>;

const SPAN_KIND_TO_NODE_TYPE: Record<string, AllNodeType> = {
  llm: "model_call",
  tool: "tool_call",
  agent: "agent_message",
  chain: "checkpoint",
  event: "memory_update",
};

export function mapSpanToExecutionNode(input: unknown): ExecutionNode {
  const span = spanInputSchema.parse(input);

  const type = SPAN_KIND_TO_NODE_TYPE[span.spanKind] ?? "agent_message";
  const status: NodeStatus = span.status === "error" ? "failure" : "success";

  return {
    nodeId: span.nodeId,
    runId: span.runId,
    branchId: span.branchId,
    parentNodeId: span.parentNodeId,
    checkpointId: span.checkpointId,
    type,
    status,
    title: span.name,
    summary: `${span.spanKind} span: ${span.name}`,
    startedAt: span.startTime,
    endedAt: span.endTime,
    payloadRef: span.payloadRef,
    validationRef: span.validationRef,
  };
}

import { policyDecisionEventSchema, type PolicyDecisionEvent } from "@nemocognition/core";

export function mapPolicyEventToExecutionNode(input: unknown): ExecutionNode {
  const event = policyDecisionEventSchema.parse(input);

  let type: AllNodeType;
  if (event.actionType === "sandbox_boundary" && event.decision === "deny") {
    type = "sandbox_violation";
  } else if (event.decision === "deny") {
    type = "policy_deny";
  } else {
    type = "policy_allow";
  }

  const status: NodeStatus = event.decision === "deny" ? "failure" : "success";

  return {
    nodeId: event.nodeId,
    runId: event.runId,
    branchId: event.branchId,
    parentNodeId: event.parentNodeId,
    checkpointId: event.checkpointId,
    type,
    status,
    title: `${event.actionType} ${event.decision}: ${event.resource}`,
    summary: `Policy rule: ${event.policyRuleText}. Reason: ${event.reason}`,
    startedAt: event.timestamp,
    endedAt: event.timestamp,
    payloadRef: event.rawPayloadRef,
    validationRef: null,
  };
}
