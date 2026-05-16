import { pgTable, text, timestamp, real, jsonb, pgEnum } from "drizzle-orm/pg-core";

export const runStatusEnum = pgEnum("run_status", ["pending", "running", "completed", "failed"]);
export const nodeStatusEnum = pgEnum("node_status", ["success", "failure", "risky", "memory", "branch"]);
export const branchStatusEnum = pgEnum("branch_status", ["running", "completed", "failed"]);
export const validationStatusEnum = pgEnum("validation_status", ["pass", "fail", "risky"]);
export const videoJobStatusEnum = pgEnum("video_job_status", ["pending", "processing", "completed", "failed"]);
export const spanKindEnum = pgEnum("span_kind", ["agent", "llm", "tool", "chain", "event"]);
export const policyDecisionEnum = pgEnum("policy_decision", ["allow", "deny"]);

export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  userTask: text("user_task").notNull(),
  status: runStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  rootBranchId: text("root_branch_id").notNull(),
});

export const executionNodes = pgTable("execution_nodes", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  branchId: text("branch_id").notNull(),
  parentId: text("parent_id"),
  type: text("type").notNull(),
  status: nodeStatusEnum("status").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  timestampStart: timestamp("timestamp_start", { withTimezone: true }).notNull(),
  timestampEnd: timestamp("timestamp_end", { withTimezone: true }),
  payloadRef: text("payload_ref"),
  payloadJson: jsonb("payload_json"),
  checkpointRef: text("checkpoint_ref"),
  validationRef: text("validation_ref"),
});

export const branches = pgTable("branches", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  parentBranchId: text("parent_branch_id"),
  forkNodeId: text("fork_node_id"),
  status: branchStatusEnum("status").notNull().default("running"),
  correctionSummary: text("correction_summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const checkpoints = pgTable("checkpoints", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  nodeId: text("node_id").notNull(),
  branchId: text("branch_id").notNull(),
  memoryRef: text("memory_ref"),
  contextRef: text("context_ref"),
  promptRef: text("prompt_ref"),
  diffRef: text("diff_ref"),
  fileTreeHashRef: text("file_tree_hash_ref"),
  envRef: text("env_ref"),
  policyRef: text("policy_ref"),
  policyResolvedRef: text("policy_resolved_ref"),
  auditWindowRef: text("audit_window_ref"),
  validationRef: text("validation_ref"),
  parentCheckpointId: text("parent_checkpoint_id"),
  phoenixTraceRef: text("phoenix_trace_ref"),
  memoryJson: jsonb("memory_json"),
  policyYaml: text("policy_yaml"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const validationResults = pgTable("validation_results", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  nodeId: text("node_id").notNull(),
  status: validationStatusEnum("status").notNull(),
  failureCategory: text("failure_category"),
  policyFailureCategory: text("policy_failure_category"),
  confidence: real("confidence").notNull(),
  evidenceJson: jsonb("evidence_json").notNull(),
  recommendedFix: text("recommended_fix"),
});

export const videoJobs = pgTable("video_jobs", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  status: videoJobStatusEnum("status").notNull().default("pending"),
  inputTraceRef: text("input_trace_ref").notNull(),
  outputVideoRef: text("output_video_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const traceSpanRefs = pgTable("trace_span_refs", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  nodeId: text("node_id").notNull(),
  phoenixSpanId: text("phoenix_span_id").notNull(),
  spanKind: spanKindEnum("span_kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const policyDecisions = pgTable("policy_decisions", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  branchId: text("branch_id").notNull(),
  nodeId: text("node_id").notNull(),
  parentNodeId: text("parent_node_id"),
  checkpointId: text("checkpoint_id"),
  actionType: text("action_type").notNull(),
  decision: policyDecisionEnum("decision").notNull(),
  resource: text("resource").notNull(),
  normalizedResource: text("normalized_resource").notNull(),
  policyRuleId: text("policy_rule_id").notNull(),
  policyRuleText: text("policy_rule_text").notNull(),
  policyPath: text("policy_path").notNull(),
  reason: text("reason").notNull(),
  actor: text("actor").notNull(),
  auditLogRef: text("audit_log_ref").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  rawPayloadRef: text("raw_payload_ref").notNull(),
});

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  nodeId: text("node_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
});
