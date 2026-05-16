import type { FailureCategory, PolicyFailureCategory, ActionType } from "../schemas";

export interface FailureInput {
  openshellDecision?: "allow" | "deny";
  actionType?: ActionType;
  evidence: string[];
  policyMisconfiguration?: boolean;
  agentReplanRequired?: boolean;
}

export interface FailureClassification {
  failureCategory: FailureCategory | null;
  policyFailureCategory: PolicyFailureCategory | null;
  confidence: number;
}

const POLICY_ACTION_MAP: Record<string, PolicyFailureCategory> = {
  file_read: "File Read Denied",
  file_write: "File Write Denied",
  network_call: "Network Denied",
  command_execution: "Command / Tool Denied",
  tool_execution: "Command / Tool Denied",
  sandbox_boundary: "Sandbox Boundary Violation",
  env_access: "Sandbox Boundary Violation",
};

const TOOL_ERROR_PATTERNS = [
  /exit code/i,
  /command failed/i,
  /timeout/i,
  /permission denied/i,
  /non-zero/i,
  /exception/i,
  /schema mismatch/i,
  /invalid json/i,
];

const KNOWLEDGE_CUTOFF_PATTERNS = [
  /deprecated/i,
  /outdated/i,
  /stale/i,
  /no longer supported/i,
  /removed in/i,
];

const LOGICAL_FAILURE_PATTERNS = [
  /hallucinated/i,
  /contradicts/i,
  /stuck loop/i,
  /circular retry/i,
  /weak verification/i,
];

function matchesAny(evidence: string[], patterns: RegExp[]): boolean {
  return evidence.some(e => patterns.some(p => p.test(e)));
}

export function classifyFailure(input: FailureInput): FailureClassification {
  if (input.openshellDecision === "deny" && input.actionType) {
    if (input.policyMisconfiguration) {
      return {
        failureCategory: null,
        policyFailureCategory: "Policy Misconfiguration",
        confidence: 0.9,
      };
    }

    if (input.agentReplanRequired) {
      return {
        failureCategory: null,
        policyFailureCategory: "Agent Replan Required",
        confidence: 0.85,
      };
    }

    const policyCategory = POLICY_ACTION_MAP[input.actionType];
    if (policyCategory) {
      return {
        failureCategory: null,
        policyFailureCategory: policyCategory,
        confidence: 0.95,
      };
    }
  }

  const evidence = input.evidence;

  if (matchesAny(evidence, TOOL_ERROR_PATTERNS)) {
    return {
      failureCategory: "Tool Call Error",
      policyFailureCategory: null,
      confidence: 0.9,
    };
  }

  if (matchesAny(evidence, KNOWLEDGE_CUTOFF_PATTERNS)) {
    return {
      failureCategory: "Knowledge Cutoff",
      policyFailureCategory: null,
      confidence: 0.8,
    };
  }

  if (matchesAny(evidence, LOGICAL_FAILURE_PATTERNS)) {
    return {
      failureCategory: "Logical Failure",
      policyFailureCategory: null,
      confidence: 0.75,
    };
  }

  return {
    failureCategory: "Knowledge Gap",
    policyFailureCategory: null,
    confidence: 0.6,
  };
}
