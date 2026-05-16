import type {
  Run,
  ExecutionNode,
  Branch,
  Checkpoint,
  ValidationResult,
  VideoJob,
  PolicyDecisionEvent,
} from "@nemocognition/core";

/**
 * Storage abstraction implemented by both InMemoryStore (dev/test) and
 * PostgresStore (production). All methods are async so a single call site can
 * back either implementation.
 */
export interface Store {
  // runs
  getRun(id: string): Promise<Run | undefined>;
  setRun(run: Run): Promise<void>;
  getAllRuns(): Promise<Run[]>;

  // execution nodes
  getNode(nodeId: string): Promise<ExecutionNode | undefined>;
  setNode(node: ExecutionNode): Promise<void>;
  getRunNodes(runId: string): Promise<ExecutionNode[]>;

  // branches
  getBranch(id: string): Promise<Branch | undefined>;
  setBranch(branch: Branch): Promise<void>;
  getRunBranches(runId: string): Promise<Branch[]>;

  // checkpoints
  getCheckpoint(id: string): Promise<Checkpoint | undefined>;
  setCheckpoint(cp: Checkpoint): Promise<void>;
  /**
   * Find the checkpoint to resume from when recovering after `nodeId` failed.
   * Walks back along the parent-node chain (same run + branch) and returns
   * the first checkpoint encountered. Falls back to the latest checkpoint on
   * the same branch when no ancestor has one.
   */
  findNearestCheckpointBeforeNode(runId: string, branchId: string, nodeId: string): Promise<Checkpoint | undefined>;
  /** All checkpoints for a (run, branch), in any order — caller sorts. */
  getRunBranchCheckpoints(runId: string, branchId: string): Promise<Checkpoint[]>;

  // policy decisions
  setPolicyDecision(pde: PolicyDecisionEvent): Promise<void>;
  getRunPolicyDecisions(runId: string): Promise<PolicyDecisionEvent[]>;
  getNodePolicyDecision(runId: string, nodeId: string): Promise<PolicyDecisionEvent | undefined>;

  // video jobs
  getVideoJob(id: string): Promise<VideoJob | undefined>;
  setVideoJob(job: VideoJob): Promise<void>;
  listPendingVideoJobs(): Promise<VideoJob[]>;

  // validation results
  getNodeValidation(runId: string, nodeId: string): Promise<ValidationResult | undefined>;
  setValidation(v: ValidationResult): Promise<void>;

  /** Liveness probe — should return true if the underlying store is reachable. */
  ping(): Promise<boolean>;
}
