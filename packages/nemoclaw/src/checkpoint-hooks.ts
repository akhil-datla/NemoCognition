import { randomUUID } from "node:crypto";

export interface CheckpointData {
  id: string;
  runId: string;
  nodeId: string;
  branchId: string;
  memory: Record<string, unknown>;
  context: Record<string, unknown>;
  prompt: string;
  policyYaml: string;
  createdAt: string;
}

interface CreateCheckpointInput {
  runId: string;
  nodeId: string;
  branchId: string;
  memory: Record<string, unknown>;
  context: Record<string, unknown>;
  prompt: string;
  policyYaml: string;
}

export class CheckpointHooks {
  private checkpoints = new Map<string, CheckpointData>();

  create(input: CreateCheckpointInput): CheckpointData {
    const checkpoint: CheckpointData = {
      id: `cp_${randomUUID()}`,
      ...input,
      createdAt: new Date().toISOString(),
    };
    this.checkpoints.set(checkpoint.id, checkpoint);
    return checkpoint;
  }

  load(id: string): CheckpointData | null {
    return this.checkpoints.get(id) ?? null;
  }

  findByNode(nodeId: string): CheckpointData | null {
    for (const cp of this.checkpoints.values()) {
      if (cp.nodeId === nodeId) return cp;
    }
    return null;
  }

  findNearest(runId: string, branchId: string): CheckpointData | null {
    let latest: CheckpointData | null = null;
    for (const cp of this.checkpoints.values()) {
      if (cp.runId === runId && cp.branchId === branchId) {
        if (!latest || cp.createdAt >= latest.createdAt) {
          latest = cp;
        }
      }
    }
    return latest;
  }

  listByRun(runId: string): CheckpointData[] {
    return Array.from(this.checkpoints.values()).filter((cp) => cp.runId === runId);
  }
}
