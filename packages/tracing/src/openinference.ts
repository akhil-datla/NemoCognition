export const OI_SPAN_KIND = "openinference.span.kind" as const;

export const OI_KIND = {
  LLM: "LLM",
  TOOL: "TOOL",
  AGENT: "AGENT",
  CHAIN: "CHAIN",
} as const;

export const ATTR = {
  llmModelName: "llm.model_name",
  llmProvider: "llm.provider",
  llmTokenCountPrompt: "llm.token_count.prompt",
  llmTokenCountCompletion: "llm.token_count.completion",
  llmLatencyMs: "llm.latency_ms",
  toolName: "tool.name",
  toolParameters: "tool.parameters",
  toolExitCode: "tool.exit_code",
  toolDurationMs: "tool.duration_ms",
  toolErrorClass: "tool.error_class",
  inputValue: "input.value",
  outputValue: "output.value",
  inputMimeType: "input.mime_type",
  outputMimeType: "output.mime_type",
  nemoRunId: "nemocognition.run_id",
  nemoBranchId: "nemocognition.branch_id",
  nemoNodeId: "nemocognition.node_id",
  nemoParentNodeId: "nemocognition.parent_node_id",
  nemoEventType: "nemocognition.event_type",
  policyDecision: "openshell.decision",
  policyActionType: "openshell.action_type",
  policyResource: "openshell.resource",
  policyRuleId: "openshell.rule_id",
  policyReason: "openshell.reason",
} as const;

/** Returns indexed OpenInference attribute keys for the n-th message. */
export function messageAttr(side: "input" | "output", index: number, suffix: "role" | "content"): string {
  return `llm.${side}_messages.${index}.message.${suffix}`;
}

export function eventTypeToOIKind(eventType: string): keyof typeof OI_KIND {
  if (eventType.startsWith("model_call")) return "LLM";
  if (eventType.startsWith("tool_call")) return "TOOL";
  if (eventType.startsWith("run_") || eventType === "agent_message") return "AGENT";
  return "CHAIN";
}
