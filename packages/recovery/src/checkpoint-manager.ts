import { randomUUID } from "crypto";

export interface CheckpointData {
  id: string;
  runId: string;
  nodeId: string;
  branchId: string;
  memory?: Record<string, unknown>;
  context?: Record<string, unknown>;
  prompt?: string;
  policyYaml?: string;
  createdAt: string;
}

export interface CheckpointStore {
  save(checkpoint: CheckpointData): Promise<void>;
  load(id: string): Promise<CheckpointData | null>;
  findByNode(runId: string, nodeId: string): Promise<CheckpointData | null>;
  findNearest(runId: string, branchId: string, beforeNodeId: string): Promise<CheckpointData | null>;
}

export interface CreateCheckpointInput {
  runId: string;
  nodeId: string;
  branchId: string;
  memory?: Record<string, unknown>;
  context?: Record<string, unknown>;
  prompt?: string;
  policyYaml?: string;
}

export class CheckpointManager {
  constructor(private store: CheckpointStore) {}

  async create(input: CreateCheckpointInput): Promise<CheckpointData> {
    const checkpoint: CheckpointData = {
      id: `cp_${randomUUID().slice(0, 8)}`,
      runId: input.runId,
      nodeId: input.nodeId,
      branchId: input.branchId,
      memory: input.memory,
      context: input.context,
      prompt: input.prompt,
      policyYaml: input.policyYaml,
      createdAt: new Date().toISOString(),
    };
    await this.store.save(checkpoint);
    return checkpoint;
  }

  async load(id: string): Promise<CheckpointData | null> {
    return this.store.load(id);
  }

  async findNearest(runId: string, branchId: string, beforeNodeId: string): Promise<CheckpointData | null> {
    return this.store.findNearest(runId, branchId, beforeNodeId);
  }
}
