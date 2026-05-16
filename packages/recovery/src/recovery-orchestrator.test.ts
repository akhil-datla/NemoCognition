import { describe, it, expect } from "vitest";
import {
  RecoveryOrchestrator,
  type RecoveryInput,
  type RecoveryResult,
} from "./recovery-orchestrator";
import type { CheckpointData } from "./checkpoint-manager";

describe("RecoveryOrchestrator", () => {
  const checkpoint: CheckpointData = {
    id: "cp_1",
    runId: "run_1",
    nodeId: "n3",
    branchId: "branch_main",
    memory: { key: "value" },
    context: { messages: ["msg1"] },
    prompt: "Create a report",
    policyYaml: "files:\n  allow_read:\n    - ./research/**",
    createdAt: "2026-05-15T10:00:00Z",
  };

  it("creates a new branch from a checkpoint", () => {
    const orchestrator = new RecoveryOrchestrator();
    const result = orchestrator.prepareRecovery({
      checkpoint,
      failedNodeId: "n5",
      failureCategory: "File Read Denied",
      humanCorrection: "Use only ./research/** files",
      recoveryStrategy: "replan_within_policy",
    });
    expect(result.newBranchId).toBeTruthy();
    expect(result.newBranchId).not.toBe("branch_main");
    expect(result.branchStartNode.type).toBe("branch_start");
    expect(result.branchStartNode.status).toBe("branch");
    expect(result.branchStartNode.branchId).toBe(result.newBranchId);
  });

  it("creates a human_correction node", () => {
    const orchestrator = new RecoveryOrchestrator();
    const result = orchestrator.prepareRecovery({
      checkpoint,
      failedNodeId: "n5",
      failureCategory: "File Read Denied",
      humanCorrection: "Avoid ./private/**",
      recoveryStrategy: "replan_within_policy",
    });
    expect(result.humanCorrectionNode.type).toBe("human_correction");
    expect(result.humanCorrectionNode.summary).toContain("Avoid ./private/**");
  });

  it("generates replan_within_policy correction prompt", () => {
    const orchestrator = new RecoveryOrchestrator();
    const result = orchestrator.prepareRecovery({
      checkpoint,
      failedNodeId: "n5",
      failureCategory: "File Read Denied",
      humanCorrection: "Use only research files",
      recoveryStrategy: "replan_within_policy",
    });
    expect(result.correctionPrompt).toContain("cp_1");
    expect(result.correctionPrompt).toContain("n5");
    expect(result.correctionPrompt).toContain("File Read Denied");
    expect(result.correctionPrompt).toContain("Use only research files");
  });

  it("generates suggest_policy_change correction prompt", () => {
    const orchestrator = new RecoveryOrchestrator();
    const result = orchestrator.prepareRecovery({
      checkpoint,
      failedNodeId: "n5",
      failureCategory: "Policy Misconfiguration",
      humanCorrection: "Allow reading config files",
      recoveryStrategy: "suggest_policy_change",
    });
    expect(result.correctionPrompt).toContain("policy misconfiguration");
    expect(result.correctionPrompt).toContain("pending human approval");
  });

  it("generates rerun_stricter_sandbox correction prompt", () => {
    const orchestrator = new RecoveryOrchestrator();
    const result = orchestrator.prepareRecovery({
      checkpoint,
      failedNodeId: "n5",
      failureCategory: "Sandbox Boundary Violation",
      humanCorrection: "Tighten sandbox",
      recoveryStrategy: "rerun_stricter_sandbox",
    });
    expect(result.correctionPrompt).toContain("stricter sandbox");
  });

  it("never mutates the original failed branch", () => {
    const orchestrator = new RecoveryOrchestrator();
    const result = orchestrator.prepareRecovery({
      checkpoint,
      failedNodeId: "n5",
      failureCategory: "File Read Denied",
      humanCorrection: "Fix it",
      recoveryStrategy: "replan_within_policy",
    });
    expect(result.branchStartNode.parentNodeId).toBe("n3");
    expect(result.newBranchId).not.toBe(checkpoint.branchId);
  });

  it("restores memory and context from checkpoint", () => {
    const orchestrator = new RecoveryOrchestrator();
    const result = orchestrator.prepareRecovery({
      checkpoint,
      failedNodeId: "n5",
      failureCategory: "Tool Call Error",
      humanCorrection: "Fix tool args",
      recoveryStrategy: "replan_within_policy",
    });
    expect(result.restoredState.memory).toEqual({ key: "value" });
    expect(result.restoredState.context).toEqual({ messages: ["msg1"] });
    expect(result.restoredState.prompt).toBe("Create a report");
  });
});
