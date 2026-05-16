import { describe, it, expect } from "vitest";
import {
  executionNodeSchema,
  runSchema,
  branchSchema,
  checkpointSchema,
  validationResultSchema,
  videoJobSchema,
  traceSpanRefSchema,
  policyDecisionEventSchema,
  requiredTraceAttributesSchema,
  failureCategorySchema,
  policyFailureCategorySchema,
  nodeTypeSchema,
  nodeStatusSchema,
  policyNodeTypeSchema,
  spanKindSchema,
  actionTypeSchema,
} from "./index";

describe("nodeTypeSchema", () => {
  it("accepts all AGENT.md node types", () => {
    const types = [
      "agent_message", "model_call", "tool_call", "tool_result",
      "memory_update", "file_diff", "validation", "failure",
      "checkpoint", "branch_start", "human_correction",
    ];
    for (const t of types) {
      expect(nodeTypeSchema.parse(t)).toBe(t);
    }
  });

  it("rejects unknown type", () => {
    expect(() => nodeTypeSchema.parse("unknown_type")).toThrow();
  });
});

describe("policyNodeTypeSchema", () => {
  it("accepts all pivot plan policy node types", () => {
    const types = [
      "policy_allow", "policy_deny", "audit_event", "sandbox_violation",
      "file_access", "network_access", "command_execution", "policy_misconfiguration",
    ];
    for (const t of types) {
      expect(policyNodeTypeSchema.parse(t)).toBe(t);
    }
  });
});

describe("nodeStatusSchema", () => {
  it("accepts valid statuses", () => {
    for (const s of ["success", "failure", "risky", "memory", "branch"]) {
      expect(nodeStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects invalid status", () => {
    expect(() => nodeStatusSchema.parse("pending")).toThrow();
  });
});

describe("failureCategorySchema", () => {
  it("accepts all four generic categories", () => {
    const cats = ["Knowledge Gap", "Knowledge Cutoff", "Tool Call Error", "Logical Failure"];
    for (const c of cats) {
      expect(failureCategorySchema.parse(c)).toBe(c);
    }
  });
});

describe("policyFailureCategorySchema", () => {
  it("accepts all seven policy categories", () => {
    const cats = [
      "File Read Denied", "File Write Denied", "Network Denied",
      "Command / Tool Denied", "Sandbox Boundary Violation",
      "Policy Misconfiguration", "Agent Replan Required",
    ];
    for (const c of cats) {
      expect(policyFailureCategorySchema.parse(c)).toBe(c);
    }
  });
});

describe("spanKindSchema", () => {
  it("accepts valid span kinds", () => {
    for (const k of ["agent", "llm", "tool", "chain", "event"]) {
      expect(spanKindSchema.parse(k)).toBe(k);
    }
  });
});

describe("actionTypeSchema", () => {
  it("accepts all policy action types", () => {
    const types = [
      "file_read", "file_write", "network_call", "command_execution",
      "tool_execution", "env_access", "sandbox_boundary",
    ];
    for (const t of types) {
      expect(actionTypeSchema.parse(t)).toBe(t);
    }
  });
});

describe("executionNodeSchema", () => {
  const validNode = {
    nodeId: "node_1",
    runId: "run_abc",
    branchId: "branch_main",
    parentNodeId: null,
    checkpointId: null,
    type: "tool_call" as const,
    status: "success" as const,
    title: "Run unit tests",
    summary: "Tests passed",
    startedAt: "2026-05-15T10:00:00Z",
    endedAt: "2026-05-15T10:00:03Z",
    payloadRef: null,
    validationRef: null,
  };

  it("accepts a valid execution node", () => {
    const result = executionNodeSchema.parse(validNode);
    expect(result.nodeId).toBe("node_1");
    expect(result.runId).toBe("run_abc");
    expect(result.type).toBe("tool_call");
  });

  it("rejects missing runId", () => {
    expect(() => executionNodeSchema.parse({ ...validNode, runId: "" })).toThrow();
  });

  it("rejects missing nodeId", () => {
    expect(() => executionNodeSchema.parse({ ...validNode, nodeId: "" })).toThrow();
  });

  it("rejects missing branchId", () => {
    expect(() => executionNodeSchema.parse({ ...validNode, branchId: "" })).toThrow();
  });

  it("accepts policy node types", () => {
    const policyNode = { ...validNode, type: "policy_deny" as const };
    const result = executionNodeSchema.parse(policyNode);
    expect(result.type).toBe("policy_deny");
  });

  it("accepts optional endedAt as null", () => {
    const result = executionNodeSchema.parse({ ...validNode, endedAt: null });
    expect(result.endedAt).toBeNull();
  });
});

describe("runSchema", () => {
  const validRun = {
    id: "run_abc",
    title: "Research report task",
    userTask: "Create a research report from allowed documents",
    status: "running" as const,
    createdAt: "2026-05-15T10:00:00Z",
    completedAt: null,
    rootBranchId: "branch_main",
  };

  it("accepts a valid run", () => {
    const result = runSchema.parse(validRun);
    expect(result.id).toBe("run_abc");
  });

  it("rejects missing id", () => {
    expect(() => runSchema.parse({ ...validRun, id: "" })).toThrow();
  });

  it("accepts valid statuses", () => {
    for (const s of ["pending", "running", "completed", "failed"]) {
      expect(runSchema.parse({ ...validRun, status: s }).status).toBe(s);
    }
  });
});

describe("branchSchema", () => {
  const validBranch = {
    id: "branch_recovery_1",
    runId: "run_abc",
    parentBranchId: "branch_main",
    forkNodeId: "node_5",
    status: "running" as const,
    correctionSummary: "Avoid reading from ./private/**",
    createdAt: "2026-05-15T10:05:00Z",
  };

  it("accepts a valid branch", () => {
    const result = branchSchema.parse(validBranch);
    expect(result.id).toBe("branch_recovery_1");
  });

  it("rejects missing runId", () => {
    expect(() => branchSchema.parse({ ...validBranch, runId: "" })).toThrow();
  });

  it("rejects missing branchId", () => {
    expect(() => branchSchema.parse({ ...validBranch, id: "" })).toThrow();
  });

  it("accepts null parentBranchId for root branch", () => {
    const root = { ...validBranch, parentBranchId: null };
    expect(branchSchema.parse(root).parentBranchId).toBeNull();
  });
});

describe("checkpointSchema", () => {
  const validCheckpoint = {
    id: "checkpoint_1",
    runId: "run_abc",
    nodeId: "node_3",
    branchId: "branch_main",
    memoryRef: "checkpoints/run_abc/checkpoint_1/memory.json",
    contextRef: "checkpoints/run_abc/checkpoint_1/context.json",
    promptRef: "checkpoints/run_abc/checkpoint_1/prompt.json",
    diffRef: "checkpoints/run_abc/checkpoint_1/filesystem.diff.patch",
    fileTreeHashRef: null,
    envRef: "checkpoints/run_abc/checkpoint_1/environment.allowlist.json",
    policyRef: null,
    policyResolvedRef: null,
    auditWindowRef: null,
    validationRef: null,
    parentCheckpointId: null,
    phoenixTraceRef: null,
    createdAt: "2026-05-15T10:00:00Z",
  };

  it("accepts a valid checkpoint", () => {
    const result = checkpointSchema.parse(validCheckpoint);
    expect(result.id).toBe("checkpoint_1");
  });

  it("rejects missing checkpointId", () => {
    expect(() => checkpointSchema.parse({ ...validCheckpoint, id: "" })).toThrow();
  });

  it("rejects missing runId", () => {
    expect(() => checkpointSchema.parse({ ...validCheckpoint, runId: "" })).toThrow();
  });

  it("rejects missing nodeId", () => {
    expect(() => checkpointSchema.parse({ ...validCheckpoint, nodeId: "" })).toThrow();
  });
});

describe("validationResultSchema", () => {
  const validResult = {
    id: "validation_1",
    runId: "run_abc",
    nodeId: "node_5",
    status: "fail" as const,
    failureCategory: "Tool Call Error" as const,
    policyFailureCategory: null,
    confidence: 0.92,
    evidence: ["pytest exit code 1", "ImportError: missing module"],
    recommendedFix: "Install dependency or update import path",
  };

  it("accepts a valid validation result", () => {
    const result = validationResultSchema.parse(validResult);
    expect(result.status).toBe("fail");
    expect(result.failureCategory).toBe("Tool Call Error");
  });

  it("accepts policy failure category", () => {
    const policyResult = {
      ...validResult,
      failureCategory: null,
      policyFailureCategory: "File Read Denied" as const,
    };
    const result = validationResultSchema.parse(policyResult);
    expect(result.policyFailureCategory).toBe("File Read Denied");
  });

  it("validates confidence is between 0 and 1", () => {
    expect(() => validationResultSchema.parse({ ...validResult, confidence: 1.5 })).toThrow();
    expect(() => validationResultSchema.parse({ ...validResult, confidence: -0.1 })).toThrow();
  });
});

describe("videoJobSchema", () => {
  const validJob = {
    id: "video_1",
    runId: "run_abc",
    status: "pending" as const,
    inputTraceRef: "phoenix/trace/run_abc",
    outputVideoRef: null,
    createdAt: "2026-05-15T10:00:00Z",
    completedAt: null,
  };

  it("accepts a valid video job", () => {
    const result = videoJobSchema.parse(validJob);
    expect(result.status).toBe("pending");
  });
});

describe("traceSpanRefSchema", () => {
  const validRef = {
    id: "ref_1",
    runId: "run_abc",
    nodeId: "node_1",
    phoenixSpanId: "span_abc_123",
    spanKind: "tool" as const,
    createdAt: "2026-05-15T10:00:00Z",
  };

  it("accepts a valid trace span ref", () => {
    const result = traceSpanRefSchema.parse(validRef);
    expect(result.spanKind).toBe("tool");
  });
});

describe("policyDecisionEventSchema", () => {
  const validEvent = {
    eventId: "evt_1",
    runId: "run_abc",
    branchId: "branch_main",
    nodeId: "node_7",
    parentNodeId: "node_6",
    checkpointId: "checkpoint_3",
    actionType: "file_read" as const,
    decision: "deny" as const,
    resource: "./private/api_keys.txt",
    normalizedResource: "./private/**",
    policyRuleId: "rule_deny_private",
    policyRuleText: "deny_read: ./private/**",
    policyPath: "files.deny_read[0]",
    reason: "File path matches deny_read pattern ./private/**",
    actor: "openshell" as const,
    auditLogRef: "audit/run_abc/evt_1.jsonl",
    timestamp: "2026-05-15T10:02:00Z",
    rawPayloadRef: "payloads/run_abc/node_7.json",
  };

  it("accepts a valid policy decision event", () => {
    const result = policyDecisionEventSchema.parse(validEvent);
    expect(result.decision).toBe("deny");
    expect(result.actionType).toBe("file_read");
  });

  it("rejects missing runId", () => {
    expect(() => policyDecisionEventSchema.parse({ ...validEvent, runId: "" })).toThrow();
  });

  it("rejects missing nodeId", () => {
    expect(() => policyDecisionEventSchema.parse({ ...validEvent, nodeId: "" })).toThrow();
  });

  it("rejects invalid decision", () => {
    expect(() => policyDecisionEventSchema.parse({ ...validEvent, decision: "maybe" })).toThrow();
  });

  it("accepts allow decision", () => {
    const allowed = { ...validEvent, decision: "allow" as const };
    expect(policyDecisionEventSchema.parse(allowed).decision).toBe("allow");
  });
});

describe("requiredTraceAttributesSchema", () => {
  const validAttrs = {
    runId: "run_abc",
    branchId: "branch_main",
    nodeId: "node_1",
    provider: "nvidia" as const,
    model: "nemotron" as const,
    spanKind: "llm" as const,
  };

  it("accepts valid trace attributes", () => {
    const result = requiredTraceAttributesSchema.parse(validAttrs);
    expect(result.provider).toBe("nvidia");
    expect(result.model).toBe("nemotron");
  });

  it("rejects non-nvidia provider", () => {
    expect(() => requiredTraceAttributesSchema.parse({ ...validAttrs, provider: "openai" })).toThrow();
  });

  it("rejects non-nemotron model", () => {
    expect(() => requiredTraceAttributesSchema.parse({ ...validAttrs, model: "gpt-4" })).toThrow();
  });

  it("accepts optional parentNodeId", () => {
    const result = requiredTraceAttributesSchema.parse({ ...validAttrs, parentNodeId: "node_0" });
    expect(result.parentNodeId).toBe("node_0");
  });

  it("accepts optional checkpointId", () => {
    const result = requiredTraceAttributesSchema.parse({ ...validAttrs, checkpointId: "cp_1" });
    expect(result.checkpointId).toBe("cp_1");
  });

  it("accepts optional openshell attributes", () => {
    const result = requiredTraceAttributesSchema.parse({
      ...validAttrs,
      openshellPolicyId: "policy_1",
      openshellRuleId: "rule_1",
      openshellDecision: "deny",
      openshellActionType: "file_read",
      openshellResource: "./private/keys.txt",
      openshellReason: "Denied by policy",
    });
    expect(result.openshellDecision).toBe("deny");
  });
});
