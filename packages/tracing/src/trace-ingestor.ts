import { randomUUID } from "node:crypto";
import type { TrackerEvent } from "@nemocognition/nemoclaw";
import type {
  Run,
  Branch,
  ExecutionNode,
  Checkpoint,
  PolicyDecisionEvent,
  AllNodeType,
  NodeStatus,
} from "@nemocognition/core";

export interface IngestResult {
  run: Run | null;
  branches: Branch[];
  nodes: ExecutionNode[];
  checkpoints: Checkpoint[];
  policyDecisions: PolicyDecisionEvent[];
}

interface PendingCall {
  startEvent: TrackerEvent;
}

export function ingestTrackerEvents(events: TrackerEvent[]): IngestResult {
  const result: IngestResult = {
    run: null,
    branches: [],
    nodes: [],
    checkpoints: [],
    policyDecisions: [],
  };

  if (events.length === 0) return result;

  const pendingCalls = new Map<string, PendingCall>();

  for (const event of events) {
    switch (event.type) {
      case "run_start": {
        result.run = {
          id: event.runId,
          title: String(event.attributes.title ?? "Untitled"),
          userTask: String(event.attributes.userTask ?? ""),
          status: "running",
          createdAt: event.timestamp,
          completedAt: null,
          rootBranchId: event.branchId,
        };
        result.branches.push({
          id: event.branchId,
          runId: event.runId,
          parentBranchId: null,
          forkNodeId: null,
          status: "running",
          correctionSummary: null,
          createdAt: event.timestamp,
        });
        result.nodes.push(makeNode(event, "agent_message", "success", "Run started", String(event.attributes.userTask ?? "")));
        break;
      }
      case "run_end": {
        if (result.run) {
          const status = String(event.attributes.status ?? "completed");
          result.run.status = status === "failed" ? "failed" : "completed";
          result.run.completedAt = event.timestamp;
        }
        break;
      }
      case "model_call_start":
      case "tool_call_start": {
        pendingCalls.set(event.nodeId, { startEvent: event });
        break;
      }
      case "model_call_end": {
        const callId = String(event.attributes.callId ?? "");
        const pending = pendingCalls.get(callId);
        if (pending) {
          const node = makeNode(
            pending.startEvent,
            "model_call",
            "success",
            "Nemotron model call",
            describeModelCall(event.attributes),
          );
          node.endedAt = event.timestamp;
          result.nodes.push(node);
          pendingCalls.delete(callId);
        }
        break;
      }
      case "tool_call_end": {
        const callId = String(event.attributes.callId ?? "");
        const pending = pendingCalls.get(callId);
        if (pending) {
          const exitCode = Number(event.attributes.exitCode ?? 0);
          const errorClass = event.attributes.errorClass as string | null;
          const status: NodeStatus = exitCode === 0 ? "success" : "failure";
          const toolName = String(pending.startEvent.attributes.toolName ?? "tool");
          const node = makeNode(
            pending.startEvent,
            "tool_call",
            status,
            `Tool: ${toolName}`,
            errorClass ? `Failed: ${errorClass}` : `Completed (exit ${exitCode})`,
          );
          node.endedAt = event.timestamp;
          result.nodes.push(node);
          pendingCalls.delete(callId);
        }
        break;
      }
      case "policy_allow":
      case "policy_deny": {
        const type: AllNodeType = event.type === "policy_allow" ? "policy_allow" : "policy_deny";
        const status: NodeStatus = event.type === "policy_allow" ? "success" : "failure";
        const resource = String(event.attributes.resource ?? "");
        const title = event.type === "policy_allow" ? `Allowed: ${resource}` : `Denied: ${resource}`;
        result.nodes.push(
          makeNode(event, type, status, title, String(event.attributes.reason ?? "")),
        );
        result.policyDecisions.push({
          eventId: `pde_${randomUUID().slice(0, 8)}`,
          runId: event.runId,
          branchId: event.branchId,
          nodeId: event.nodeId,
          parentNodeId: event.parentNodeId,
          checkpointId: null,
          actionType: event.attributes.actionType as PolicyDecisionEvent["actionType"],
          decision: event.attributes.decision as "allow" | "deny",
          resource,
          normalizedResource: String(event.attributes.normalizedResource ?? ""),
          policyRuleId: String(event.attributes.policyRuleId ?? ""),
          policyRuleText: String(event.attributes.policyRuleText ?? ""),
          policyPath: String(event.attributes.policyPath ?? ""),
          reason: String(event.attributes.reason ?? ""),
          actor: (event.attributes.actor as PolicyDecisionEvent["actor"]) ?? "openshell",
          auditLogRef: `audit/${event.runId}/${event.nodeId}`,
          timestamp: event.timestamp,
          rawPayloadRef: `payload/${event.nodeId}`,
        });
        break;
      }
      case "checkpoint": {
        const cpId = String(event.attributes.checkpointId ?? `cp_${randomUUID().slice(0, 8)}`);
        const memory = event.attributes.memory as Record<string, unknown> | undefined;
        const policyYaml = event.attributes.policyYaml as string | undefined;
        result.nodes.push(makeNode(event, "checkpoint", "success", "Checkpoint", `Checkpoint ${cpId}`));
        result.checkpoints.push({
          id: cpId,
          runId: event.runId,
          nodeId: event.nodeId,
          branchId: event.branchId,
          memoryRef: null,
          contextRef: null,
          promptRef: null,
          diffRef: null,
          fileTreeHashRef: null,
          envRef: null,
          policyRef: null,
          policyResolvedRef: null,
          auditWindowRef: null,
          validationRef: null,
          parentCheckpointId: null,
          phoenixTraceRef: null,
          memoryJson: memory ?? null,
          policyYaml: policyYaml ?? null,
          createdAt: event.timestamp,
        });
        break;
      }
      case "memory_update": {
        result.nodes.push(
          makeNode(event, "memory_update", "memory", "Memory update", String(event.attributes.key ?? "memory")),
        );
        break;
      }
      case "file_diff": {
        result.nodes.push(
          makeNode(event, "file_diff", "success", "File diff", String(event.attributes.path ?? "")),
        );
        break;
      }
      case "validation": {
        const passed = event.attributes.status === "pass";
        result.nodes.push(
          makeNode(event, "validation", passed ? "success" : "failure", "Validation", String(event.attributes.status ?? "")),
        );
        break;
      }
    }
  }

  return result;
}

function makeNode(
  event: TrackerEvent,
  type: AllNodeType,
  status: NodeStatus,
  title: string,
  summary: string,
): ExecutionNode {
  return {
    nodeId: event.nodeId,
    runId: event.runId,
    branchId: event.branchId,
    parentNodeId: event.parentNodeId,
    checkpointId: null,
    type,
    status,
    title,
    summary,
    startedAt: event.timestamp,
    endedAt: null,
    payloadRef: null,
    validationRef: null,
  };
}

function describeModelCall(attrs: Record<string, unknown>): string {
  const tc = attrs.tokenCount as { input?: number; output?: number } | undefined;
  const latency = attrs.latencyMs;
  const parts: string[] = ["nvidia/nemotron"];
  if (tc) parts.push(`${tc.input}→${tc.output} tokens`);
  if (typeof latency === "number") parts.push(`${latency}ms`);
  return parts.join(" • ");
}
