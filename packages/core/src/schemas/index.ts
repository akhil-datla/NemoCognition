import { z } from "zod";

export const nodeTypeSchema = z.enum([
  "agent_message",
  "model_call",
  "tool_call",
  "tool_result",
  "memory_update",
  "file_diff",
  "validation",
  "failure",
  "checkpoint",
  "branch_start",
  "human_correction",
]);
export type NodeType = z.infer<typeof nodeTypeSchema>;

export const policyNodeTypeSchema = z.enum([
  "policy_allow",
  "policy_deny",
  "audit_event",
  "sandbox_violation",
  "file_access",
  "network_access",
  "command_execution",
  "policy_misconfiguration",
]);
export type PolicyNodeType = z.infer<typeof policyNodeTypeSchema>;

export const allNodeTypeSchema = z.union([nodeTypeSchema, policyNodeTypeSchema]);
export type AllNodeType = z.infer<typeof allNodeTypeSchema>;

export const nodeStatusSchema = z.enum(["success", "failure", "risky", "memory", "branch"]);
export type NodeStatus = z.infer<typeof nodeStatusSchema>;

export const failureCategorySchema = z.enum([
  "Knowledge Gap",
  "Knowledge Cutoff",
  "Tool Call Error",
  "Logical Failure",
]);
export type FailureCategory = z.infer<typeof failureCategorySchema>;

export const policyFailureCategorySchema = z.enum([
  "File Read Denied",
  "File Write Denied",
  "Network Denied",
  "Command / Tool Denied",
  "Sandbox Boundary Violation",
  "Policy Misconfiguration",
  "Agent Replan Required",
]);
export type PolicyFailureCategory = z.infer<typeof policyFailureCategorySchema>;

export const spanKindSchema = z.enum(["agent", "llm", "tool", "chain", "event"]);
export type SpanKind = z.infer<typeof spanKindSchema>;

export const actionTypeSchema = z.enum([
  "file_read",
  "file_write",
  "network_call",
  "command_execution",
  "tool_execution",
  "env_access",
  "sandbox_boundary",
]);
export type ActionType = z.infer<typeof actionTypeSchema>;

export const executionNodeSchema = z.object({
  nodeId: z.string().min(1),
  runId: z.string().min(1),
  branchId: z.string().min(1),
  parentNodeId: z.string().nullable(),
  checkpointId: z.string().nullable(),
  type: allNodeTypeSchema,
  status: nodeStatusSchema,
  title: z.string(),
  summary: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  payloadRef: z.string().nullable(),
  validationRef: z.string().nullable(),
});
export type ExecutionNode = z.infer<typeof executionNodeSchema>;

export const runSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  userTask: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  rootBranchId: z.string().min(1),
});
export type Run = z.infer<typeof runSchema>;

export const branchSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  parentBranchId: z.string().nullable(),
  forkNodeId: z.string().nullable(),
  status: z.enum(["running", "completed", "failed"]),
  correctionSummary: z.string().nullable(),
  createdAt: z.string(),
});
export type Branch = z.infer<typeof branchSchema>;

export const checkpointSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  nodeId: z.string().min(1),
  branchId: z.string().min(1),
  memoryRef: z.string().nullable(),
  contextRef: z.string().nullable(),
  promptRef: z.string().nullable(),
  diffRef: z.string().nullable(),
  fileTreeHashRef: z.string().nullable(),
  envRef: z.string().nullable(),
  policyRef: z.string().nullable(),
  policyResolvedRef: z.string().nullable(),
  auditWindowRef: z.string().nullable(),
  validationRef: z.string().nullable(),
  parentCheckpointId: z.string().nullable(),
  phoenixTraceRef: z.string().nullable(),
  createdAt: z.string(),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;

export const validationResultSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  nodeId: z.string().min(1),
  status: z.enum(["pass", "fail", "risky"]),
  failureCategory: failureCategorySchema.nullable(),
  policyFailureCategory: policyFailureCategorySchema.nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  recommendedFix: z.string().nullable(),
});
export type ValidationResult = z.infer<typeof validationResultSchema>;

export const videoJobSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  status: z.enum(["pending", "processing", "completed", "failed"]),
  inputTraceRef: z.string(),
  outputVideoRef: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type VideoJob = z.infer<typeof videoJobSchema>;

export const traceSpanRefSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  nodeId: z.string().min(1),
  phoenixSpanId: z.string().min(1),
  spanKind: spanKindSchema,
  createdAt: z.string(),
});
export type TraceSpanRef = z.infer<typeof traceSpanRefSchema>;

export const policyDecisionEventSchema = z.object({
  eventId: z.string().min(1),
  runId: z.string().min(1),
  branchId: z.string().min(1),
  nodeId: z.string().min(1),
  parentNodeId: z.string().nullable(),
  checkpointId: z.string().nullable(),
  actionType: actionTypeSchema,
  decision: z.enum(["allow", "deny"]),
  resource: z.string(),
  normalizedResource: z.string(),
  policyRuleId: z.string(),
  policyRuleText: z.string(),
  policyPath: z.string(),
  reason: z.string(),
  actor: z.enum(["nemoclaw_agent", "openshell", "runtime_hook"]),
  auditLogRef: z.string(),
  timestamp: z.string(),
  rawPayloadRef: z.string(),
});
export type PolicyDecisionEvent = z.infer<typeof policyDecisionEventSchema>;

export const requiredTraceAttributesSchema = z.object({
  runId: z.string().min(1),
  branchId: z.string().min(1),
  nodeId: z.string().min(1),
  parentNodeId: z.string().optional(),
  checkpointId: z.string().optional(),
  provider: z.literal("nvidia"),
  model: z.literal("nemotron"),
  spanKind: spanKindSchema,
  openshellPolicyId: z.string().optional(),
  openshellRuleId: z.string().optional(),
  openshellDecision: z.string().optional(),
  openshellActionType: z.string().optional(),
  openshellResource: z.string().optional(),
  openshellReason: z.string().optional(),
  auditLogRef: z.string().optional(),
  memorySnapshotRef: z.string().optional(),
  fileDiffRef: z.string().optional(),
  environmentSnapshotRef: z.string().optional(),
  payloadRef: z.string().optional(),
  validationRef: z.string().optional(),
});
export type RequiredTraceAttributes = z.infer<typeof requiredTraceAttributesSchema>;
