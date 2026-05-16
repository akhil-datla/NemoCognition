import { randomUUID } from "crypto";
import type { ExecutionNode } from "@nemocognition/core";
import type { CheckpointData } from "./checkpoint-manager";

export type RecoveryStrategy =
  | "replan_within_policy"
  | "suggest_policy_change"
  | "rerun_stricter_sandbox";

export interface RecoveryInput {
  checkpoint: CheckpointData;
  failedNodeId: string;
  failureCategory: string;
  humanCorrection: string;
  recoveryStrategy: RecoveryStrategy;
}

export interface RestoredState {
  memory: Record<string, unknown> | undefined;
  context: Record<string, unknown> | undefined;
  prompt: string | undefined;
  policyYaml: string | undefined;
}

export interface RecoveryResult {
  newBranchId: string;
  branchStartNode: ExecutionNode;
  humanCorrectionNode: ExecutionNode;
  correctionPrompt: string;
  restoredState: RestoredState;
}

export class RecoveryOrchestrator {
  prepareRecovery(input: RecoveryInput): RecoveryResult {
    const newBranchId = `branch_recovery_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const branchStartNode: ExecutionNode = {
      nodeId: `node_bs_${randomUUID().slice(0, 8)}`,
      runId: input.checkpoint.runId,
      branchId: newBranchId,
      parentNodeId: input.checkpoint.nodeId,
      checkpointId: input.checkpoint.id,
      type: "branch_start",
      status: "branch",
      title: `Recovery branch from ${input.checkpoint.id}`,
      summary: `Forked from checkpoint ${input.checkpoint.id} after failure at ${input.failedNodeId}`,
      startedAt: now,
      endedAt: now,
      payloadRef: null,
      validationRef: null,
    };

    const humanCorrectionNode: ExecutionNode = {
      nodeId: `node_hc_${randomUUID().slice(0, 8)}`,
      runId: input.checkpoint.runId,
      branchId: newBranchId,
      parentNodeId: branchStartNode.nodeId,
      checkpointId: input.checkpoint.id,
      type: "human_correction",
      status: "success",
      title: "Human correction applied",
      summary: input.humanCorrection,
      startedAt: now,
      endedAt: now,
      payloadRef: null,
      validationRef: null,
    };

    const correctionPrompt = this.buildCorrectionPrompt(input);

    const restoredState: RestoredState = {
      memory: input.checkpoint.memory,
      context: input.checkpoint.context,
      prompt: input.checkpoint.prompt,
      policyYaml: input.checkpoint.policyYaml,
    };

    return {
      newBranchId,
      branchStartNode,
      humanCorrectionNode,
      correctionPrompt,
      restoredState,
    };
  }

  private buildCorrectionPrompt(input: RecoveryInput): string {
    switch (input.recoveryStrategy) {
      case "replan_within_policy":
        return [
          `You are resuming from checkpoint ${input.checkpoint.id}.`,
          `The previous branch was blocked at node ${input.failedNodeId}.`,
          `NemoClaw/OpenShell decision: deny.`,
          `Policy category: ${input.failureCategory}.`,
          `Human correction: ${input.humanCorrection}.`,
          `Continue using only allowed resources and verify the result before completion.`,
        ].join("\n");

      case "suggest_policy_change":
        return [
          `You are resuming from checkpoint ${input.checkpoint.id}.`,
          `The previous branch was blocked at node ${input.failedNodeId}.`,
          `This appears to be a policy misconfiguration because the task requires access that was denied.`,
          `Suggested YAML diff is pending human approval.`,
          `Do not bypass policy. Wait for approved policy and then continue.`,
        ].join("\n");

      case "rerun_stricter_sandbox":
        return [
          `You are resuming from checkpoint ${input.checkpoint.id}.`,
          `The previous branch was blocked at node ${input.failedNodeId}.`,
          `Rerunning in a stricter sandbox with tightened policy.`,
          `Policy category: ${input.failureCategory}.`,
          `Human correction: ${input.humanCorrection}.`,
          `Operate within the tightened boundaries and verify all actions are allowed.`,
        ].join("\n");
    }
  }
}
