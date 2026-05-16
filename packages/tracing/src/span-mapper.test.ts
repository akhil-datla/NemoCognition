import { describe, it, expect } from "vitest";
import { mapSpanToExecutionNode, mapPolicyEventToExecutionNode } from "./span-mapper";
import type { ExecutionNode } from "@nemocognition/core";

describe("mapSpanToExecutionNode", () => {
  const baseSpan = {
    runId: "run_1",
    branchId: "branch_main",
    nodeId: "node_1",
    parentNodeId: "node_0",
    checkpointId: null,
    provider: "nvidia" as const,
    model: "nemotron" as const,
    spanKind: "llm" as const,
    name: "Generate research plan",
    startTime: "2026-05-15T10:00:00Z",
    endTime: "2026-05-15T10:00:02Z",
    status: "ok" as const,
    payloadRef: "payloads/run_1/node_1.json",
    validationRef: null,
  };

  it("maps an LLM span to a model_call node", () => {
    const node = mapSpanToExecutionNode(baseSpan);
    expect(node.type).toBe("model_call");
    expect(node.status).toBe("success");
    expect(node.nodeId).toBe("node_1");
    expect(node.runId).toBe("run_1");
    expect(node.branchId).toBe("branch_main");
    expect(node.parentNodeId).toBe("node_0");
    expect(node.startedAt).toBe("2026-05-15T10:00:00Z");
    expect(node.endedAt).toBe("2026-05-15T10:00:02Z");
  });

  it("maps a tool span to a tool_call node", () => {
    const toolSpan = { ...baseSpan, spanKind: "tool" as const, name: "cat ./research/paper.md" };
    const node = mapSpanToExecutionNode(toolSpan);
    expect(node.type).toBe("tool_call");
  });

  it("maps an agent span to an agent_message node", () => {
    const agentSpan = { ...baseSpan, spanKind: "agent" as const, name: "NemoClaw run" };
    const node = mapSpanToExecutionNode(agentSpan);
    expect(node.type).toBe("agent_message");
  });

  it("maps a chain span to a checkpoint node", () => {
    const chainSpan = { ...baseSpan, spanKind: "chain" as const, name: "Recovery segment" };
    const node = mapSpanToExecutionNode(chainSpan);
    expect(node.type).toBe("checkpoint");
  });

  it("maps an event span to a memory_update node", () => {
    const eventSpan = { ...baseSpan, spanKind: "event" as const, name: "Memory updated" };
    const node = mapSpanToExecutionNode(eventSpan);
    expect(node.type).toBe("memory_update");
  });

  it("marks error status as failure", () => {
    const errorSpan = { ...baseSpan, status: "error" as const };
    const node = mapSpanToExecutionNode(errorSpan);
    expect(node.status).toBe("failure");
  });

  it("preserves payloadRef and validationRef", () => {
    const span = { ...baseSpan, validationRef: "validations/v_1.json" };
    const node = mapSpanToExecutionNode(span);
    expect(node.payloadRef).toBe("payloads/run_1/node_1.json");
    expect(node.validationRef).toBe("validations/v_1.json");
  });

  it("rejects invalid span missing required fields", () => {
    const bad = { ...baseSpan, runId: "" };
    expect(() => mapSpanToExecutionNode(bad)).toThrow();
  });

  it("rejects non-nvidia provider", () => {
    const bad = { ...baseSpan, provider: "openai" };
    expect(() => mapSpanToExecutionNode(bad as any)).toThrow();
  });
});

describe("mapPolicyEventToExecutionNode", () => {
  const baseEvent = {
    eventId: "evt_1",
    runId: "run_1",
    branchId: "branch_main",
    nodeId: "node_7",
    parentNodeId: "node_6",
    checkpointId: "cp_3",
    actionType: "file_read" as const,
    decision: "deny" as const,
    resource: "./private/api_keys.txt",
    normalizedResource: "./private/**",
    policyRuleId: "rule_deny_private",
    policyRuleText: "deny_read: ./private/**",
    policyPath: "files.deny_read[0]",
    reason: "File path matches deny_read pattern",
    actor: "openshell" as const,
    auditLogRef: "audit/run_1/evt_1.jsonl",
    timestamp: "2026-05-15T10:02:00Z",
    rawPayloadRef: "payloads/run_1/node_7.json",
  };

  it("maps a deny event to a policy_deny node with failure status", () => {
    const node = mapPolicyEventToExecutionNode(baseEvent);
    expect(node.type).toBe("policy_deny");
    expect(node.status).toBe("failure");
    expect(node.nodeId).toBe("node_7");
    expect(node.title).toContain("file_read");
  });

  it("maps an allow event to a policy_allow node with success status", () => {
    const allowEvent = { ...baseEvent, decision: "allow" as const };
    const node = mapPolicyEventToExecutionNode(allowEvent);
    expect(node.type).toBe("policy_allow");
    expect(node.status).toBe("success");
  });

  it("includes policy rule text in summary", () => {
    const node = mapPolicyEventToExecutionNode(baseEvent);
    expect(node.summary).toContain("deny_read: ./private/**");
  });

  it("sets checkpointId from event", () => {
    const node = mapPolicyEventToExecutionNode(baseEvent);
    expect(node.checkpointId).toBe("cp_3");
  });

  it("maps sandbox_boundary deny to sandbox_violation type", () => {
    const sandboxEvent = { ...baseEvent, actionType: "sandbox_boundary" as const };
    const node = mapPolicyEventToExecutionNode(sandboxEvent);
    expect(node.type).toBe("sandbox_violation");
  });
});
