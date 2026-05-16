import { describe, it, expect } from "vitest";
import { classifyFailure, type FailureInput } from "./failure-classifier";

describe("classifyFailure — policy categories (primary)", () => {
  it("classifies file_read + deny as File Read Denied", () => {
    const result = classifyFailure({
      openshellDecision: "deny",
      actionType: "file_read",
      evidence: [],
    });
    expect(result.policyFailureCategory).toBe("File Read Denied");
    expect(result.failureCategory).toBeNull();
  });

  it("classifies file_write + deny as File Write Denied", () => {
    const result = classifyFailure({
      openshellDecision: "deny",
      actionType: "file_write",
      evidence: [],
    });
    expect(result.policyFailureCategory).toBe("File Write Denied");
  });

  it("classifies network_call + deny as Network Denied", () => {
    const result = classifyFailure({
      openshellDecision: "deny",
      actionType: "network_call",
      evidence: [],
    });
    expect(result.policyFailureCategory).toBe("Network Denied");
  });

  it("classifies command_execution + deny as Command / Tool Denied", () => {
    const result = classifyFailure({
      openshellDecision: "deny",
      actionType: "command_execution",
      evidence: [],
    });
    expect(result.policyFailureCategory).toBe("Command / Tool Denied");
  });

  it("classifies tool_execution + deny as Command / Tool Denied", () => {
    const result = classifyFailure({
      openshellDecision: "deny",
      actionType: "tool_execution",
      evidence: [],
    });
    expect(result.policyFailureCategory).toBe("Command / Tool Denied");
  });

  it("classifies sandbox_boundary + deny as Sandbox Boundary Violation", () => {
    const result = classifyFailure({
      openshellDecision: "deny",
      actionType: "sandbox_boundary",
      evidence: [],
    });
    expect(result.policyFailureCategory).toBe("Sandbox Boundary Violation");
  });

  it("classifies env_access + deny as Sandbox Boundary Violation", () => {
    const result = classifyFailure({
      openshellDecision: "deny",
      actionType: "env_access",
      evidence: [],
    });
    expect(result.policyFailureCategory).toBe("Sandbox Boundary Violation");
  });

  it("classifies policy misconfiguration when flagged", () => {
    const result = classifyFailure({
      openshellDecision: "deny",
      actionType: "file_read",
      evidence: [],
      policyMisconfiguration: true,
    });
    expect(result.policyFailureCategory).toBe("Policy Misconfiguration");
  });

  it("classifies Agent Replan Required when policy is correct but agent chose wrong", () => {
    const result = classifyFailure({
      openshellDecision: "deny",
      actionType: "file_read",
      evidence: [],
      agentReplanRequired: true,
    });
    expect(result.policyFailureCategory).toBe("Agent Replan Required");
  });
});

describe("classifyFailure — generic categories (secondary)", () => {
  it("classifies Tool Call Error from exit code evidence", () => {
    const result = classifyFailure({
      evidence: ["exit code 1", "command failed"],
    });
    expect(result.failureCategory).toBe("Tool Call Error");
    expect(result.policyFailureCategory).toBeNull();
  });

  it("classifies Tool Call Error from timeout evidence", () => {
    const result = classifyFailure({
      evidence: ["timeout exceeded"],
    });
    expect(result.failureCategory).toBe("Tool Call Error");
  });

  it("classifies Tool Call Error from permission error evidence", () => {
    const result = classifyFailure({
      evidence: ["permission denied"],
    });
    expect(result.failureCategory).toBe("Tool Call Error");
  });

  it("classifies Knowledge Cutoff from outdated/deprecated evidence", () => {
    const result = classifyFailure({
      evidence: ["deprecated API", "outdated version used"],
    });
    expect(result.failureCategory).toBe("Knowledge Cutoff");
  });

  it("classifies Logical Failure from hallucination evidence", () => {
    const result = classifyFailure({
      evidence: ["hallucinated success", "output contradicts tests"],
    });
    expect(result.failureCategory).toBe("Logical Failure");
  });

  it("classifies Logical Failure from stuck loop evidence", () => {
    const result = classifyFailure({
      evidence: ["stuck loop detected", "circular retry"],
    });
    expect(result.failureCategory).toBe("Logical Failure");
  });

  it("defaults to Knowledge Gap when no pattern matches", () => {
    const result = classifyFailure({
      evidence: ["agent confused about task requirements"],
    });
    expect(result.failureCategory).toBe("Knowledge Gap");
  });

  it("returns confidence score", () => {
    const result = classifyFailure({
      evidence: ["exit code 1"],
    });
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
