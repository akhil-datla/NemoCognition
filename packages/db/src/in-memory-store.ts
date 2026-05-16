import type { Run, ExecutionNode, Branch, Checkpoint, ValidationResult, VideoJob, PolicyDecisionEvent } from "@nemocognition/core";

export class InMemoryStore {
  runs = new Map<string, Run>();
  nodes = new Map<string, ExecutionNode>();
  branches = new Map<string, Branch>();
  checkpoints = new Map<string, Checkpoint>();
  validations = new Map<string, ValidationResult>();
  videoJobs = new Map<string, VideoJob>();
  policyDecisions = new Map<string, PolicyDecisionEvent>();

  getRunNodes(runId: string): ExecutionNode[] {
    return [...this.nodes.values()].filter(n => n.runId === runId);
  }

  getRunBranches(runId: string): Branch[] {
    return [...this.branches.values()].filter(b => b.runId === runId);
  }

  getNodesByBranch(runId: string, branchId: string): ExecutionNode[] {
    return [...this.nodes.values()].filter(n => n.runId === runId && n.branchId === branchId);
  }

  getRunPolicyDecisions(runId: string): PolicyDecisionEvent[] {
    return [...this.policyDecisions.values()].filter(p => p.runId === runId);
  }

  getNodePolicyDecision(runId: string, nodeId: string): PolicyDecisionEvent | undefined {
    return [...this.policyDecisions.values()].find(p => p.runId === runId && p.nodeId === nodeId);
  }

  getAllRuns(): Run[] {
    return [...this.runs.values()];
  }
}

export const store = new InMemoryStore();
