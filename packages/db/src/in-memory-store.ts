import type {
  Run,
  ExecutionNode,
  Branch,
  Checkpoint,
  ValidationResult,
  VideoJob,
  PolicyDecisionEvent,
} from "@nemocognition/core";
import type { Store } from "./store";

export class InMemoryStore implements Store {
  // Public Maps kept for back-compat with existing tests that mutate state
  // directly. Production code should go through the async Store interface.
  runs = new Map<string, Run>();
  nodes = new Map<string, ExecutionNode>();
  branches = new Map<string, Branch>();
  checkpoints = new Map<string, Checkpoint>();
  validations = new Map<string, ValidationResult>();
  videoJobs = new Map<string, VideoJob>();
  policyDecisions = new Map<string, PolicyDecisionEvent>();

  // -- runs --
  async getRun(id: string): Promise<Run | undefined> {
    return this.runs.get(id);
  }
  async setRun(run: Run): Promise<void> {
    this.runs.set(run.id, run);
  }
  async getAllRuns(): Promise<Run[]> {
    return [...this.runs.values()];
  }

  // -- nodes --
  async getNode(nodeId: string): Promise<ExecutionNode | undefined> {
    return this.nodes.get(nodeId);
  }
  async setNode(node: ExecutionNode): Promise<void> {
    this.nodes.set(node.nodeId, node);
  }
  async getRunNodes(runId: string): Promise<ExecutionNode[]> {
    return [...this.nodes.values()].filter((n) => n.runId === runId);
  }

  // -- branches --
  async getBranch(id: string): Promise<Branch | undefined> {
    return this.branches.get(id);
  }
  async setBranch(branch: Branch): Promise<void> {
    this.branches.set(branch.id, branch);
  }
  async getRunBranches(runId: string): Promise<Branch[]> {
    return [...this.branches.values()].filter((b) => b.runId === runId);
  }

  // -- checkpoints --
  async getCheckpoint(id: string): Promise<Checkpoint | undefined> {
    return this.checkpoints.get(id);
  }
  async setCheckpoint(cp: Checkpoint): Promise<void> {
    this.checkpoints.set(cp.id, cp);
  }
  async findNearestCheckpointBeforeNode(
    runId: string,
    branchId: string,
    nodeId: string,
  ): Promise<Checkpoint | undefined> {
    const cpByNode = new Map<string, Checkpoint>();
    for (const cp of this.checkpoints.values()) {
      if (cp.runId === runId && cp.branchId === branchId) cpByNode.set(cp.nodeId, cp);
    }
    // Walk back along parentNodeId until we hit a checkpointed node.
    let cursor = this.nodes.get(nodeId);
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.nodeId)) {
      seen.add(cursor.nodeId);
      const hit = cpByNode.get(cursor.nodeId);
      if (hit) return hit;
      if (!cursor.parentNodeId) break;
      cursor = this.nodes.get(cursor.parentNodeId);
    }
    // Fallback: latest checkpoint on the same branch.
    let latest: Checkpoint | undefined;
    for (const cp of cpByNode.values()) {
      if (!latest || cp.createdAt >= latest.createdAt) latest = cp;
    }
    return latest;
  }

  async getRunBranchCheckpoints(runId: string, branchId: string): Promise<Checkpoint[]> {
    return [...this.checkpoints.values()].filter(
      (cp) => cp.runId === runId && cp.branchId === branchId,
    );
  }

  // -- policy decisions --
  async setPolicyDecision(pde: PolicyDecisionEvent): Promise<void> {
    this.policyDecisions.set(pde.eventId, pde);
  }
  async getRunPolicyDecisions(runId: string): Promise<PolicyDecisionEvent[]> {
    return [...this.policyDecisions.values()].filter((p) => p.runId === runId);
  }
  async getNodePolicyDecision(
    runId: string,
    nodeId: string,
  ): Promise<PolicyDecisionEvent | undefined> {
    return [...this.policyDecisions.values()].find((p) => p.runId === runId && p.nodeId === nodeId);
  }

  // -- video jobs --
  async getVideoJob(id: string): Promise<VideoJob | undefined> {
    return this.videoJobs.get(id);
  }
  async setVideoJob(job: VideoJob): Promise<void> {
    this.videoJobs.set(job.id, job);
  }
  async listPendingVideoJobs(): Promise<VideoJob[]> {
    return [...this.videoJobs.values()].filter((j) => j.status === "pending");
  }

  // -- validations --
  async getNodeValidation(runId: string, nodeId: string): Promise<ValidationResult | undefined> {
    return [...this.validations.values()].find((v) => v.runId === runId && v.nodeId === nodeId);
  }
  async setValidation(v: ValidationResult): Promise<void> {
    this.validations.set(v.id, v);
  }

  async ping(): Promise<boolean> {
    return true;
  }
}

// Attach to globalThis so the singleton survives Next.js dev-mode module
// re-instantiation (Turbopack isolates route bundles per request).
const GLOBAL_KEY = "__nemocognition_store__";
const g = globalThis as unknown as Record<string, InMemoryStore | undefined>;
export const store: InMemoryStore = g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = new InMemoryStore());
