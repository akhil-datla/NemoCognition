import { eq, and, sql } from "drizzle-orm";
import type {
  Run,
  ExecutionNode,
  Branch,
  Checkpoint,
  ValidationResult,
  VideoJob,
  PolicyDecisionEvent,
  NodeStatus,
  AllNodeType,
  FailureCategory,
  PolicyFailureCategory,
} from "@nemocognition/core";
import type { Store } from "./store";
import type { Database } from "./client";
import * as s from "./schema";

function isoFromDate(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

export class PostgresStore implements Store {
  constructor(private db: Database) {}

  async ping(): Promise<boolean> {
    try {
      await this.db.execute(sql`select 1`);
      return true;
    } catch {
      return false;
    }
  }

  // -- runs --
  async getRun(id: string): Promise<Run | undefined> {
    const rows = await this.db.select().from(s.runs).where(eq(s.runs.id, id)).limit(1);
    const r = rows[0];
    if (!r) return undefined;
    return {
      id: r.id,
      title: r.title,
      userTask: r.userTask,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      completedAt: isoFromDate(r.completedAt),
      rootBranchId: r.rootBranchId,
    };
  }

  async setRun(run: Run): Promise<void> {
    await this.db
      .insert(s.runs)
      .values({
        id: run.id,
        title: run.title,
        userTask: run.userTask,
        status: run.status,
        createdAt: new Date(run.createdAt),
        completedAt: run.completedAt ? new Date(run.completedAt) : null,
        rootBranchId: run.rootBranchId,
      })
      .onConflictDoUpdate({
        target: s.runs.id,
        set: {
          title: run.title,
          userTask: run.userTask,
          status: run.status,
          completedAt: run.completedAt ? new Date(run.completedAt) : null,
          rootBranchId: run.rootBranchId,
        },
      });
  }

  async getAllRuns(): Promise<Run[]> {
    const rows = await this.db.select().from(s.runs);
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      userTask: r.userTask,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      completedAt: isoFromDate(r.completedAt),
      rootBranchId: r.rootBranchId,
    }));
  }

  // -- nodes --
  async getNode(nodeId: string): Promise<ExecutionNode | undefined> {
    const rows = await this.db.select().from(s.executionNodes).where(eq(s.executionNodes.id, nodeId)).limit(1);
    const n = rows[0];
    if (!n) return undefined;
    return this.toExecutionNode(n);
  }

  async setNode(node: ExecutionNode): Promise<void> {
    await this.db
      .insert(s.executionNodes)
      .values({
        id: node.nodeId,
        runId: node.runId,
        branchId: node.branchId,
        parentId: node.parentNodeId,
        type: node.type,
        status: node.status,
        title: node.title,
        summary: node.summary,
        timestampStart: new Date(node.startedAt),
        timestampEnd: node.endedAt ? new Date(node.endedAt) : null,
        payloadRef: node.payloadRef,
        checkpointRef: node.checkpointId,
        validationRef: node.validationRef,
      })
      .onConflictDoUpdate({
        target: s.executionNodes.id,
        set: {
          status: node.status,
          title: node.title,
          summary: node.summary,
          timestampEnd: node.endedAt ? new Date(node.endedAt) : null,
          payloadRef: node.payloadRef,
          validationRef: node.validationRef,
        },
      });
  }

  async getRunNodes(runId: string): Promise<ExecutionNode[]> {
    const rows = await this.db.select().from(s.executionNodes).where(eq(s.executionNodes.runId, runId));
    return rows.map((r) => this.toExecutionNode(r));
  }

  // -- branches --
  async getBranch(id: string): Promise<Branch | undefined> {
    const rows = await this.db.select().from(s.branches).where(eq(s.branches.id, id)).limit(1);
    const b = rows[0];
    if (!b) return undefined;
    return this.toBranch(b);
  }

  async setBranch(branch: Branch): Promise<void> {
    await this.db
      .insert(s.branches)
      .values({
        id: branch.id,
        runId: branch.runId,
        parentBranchId: branch.parentBranchId,
        forkNodeId: branch.forkNodeId,
        status: branch.status,
        correctionSummary: branch.correctionSummary,
        createdAt: new Date(branch.createdAt),
      })
      .onConflictDoUpdate({
        target: s.branches.id,
        set: {
          status: branch.status,
          correctionSummary: branch.correctionSummary,
        },
      });
  }

  async getRunBranches(runId: string): Promise<Branch[]> {
    const rows = await this.db.select().from(s.branches).where(eq(s.branches.runId, runId));
    return rows.map((r) => this.toBranch(r));
  }

  // -- checkpoints --
  async getCheckpoint(id: string): Promise<Checkpoint | undefined> {
    const rows = await this.db.select().from(s.checkpoints).where(eq(s.checkpoints.id, id)).limit(1);
    const c = rows[0];
    if (!c) return undefined;
    return this.toCheckpoint(c);
  }

  async findNearestCheckpointBeforeNode(
    runId: string,
    branchId: string,
    nodeId: string,
  ): Promise<Checkpoint | undefined> {
    // Single query: pull all checkpoints + all nodes for the (run, branch).
    // For typical run sizes (hundreds of nodes) the in-memory walk is cheap;
    // a recursive CTE would be more efficient at scale but isn't worth the
    // complexity here.
    const cps = await this.getRunBranchCheckpointsByNode(runId, branchId);
    const nodes = await this.db
      .select({ id: s.executionNodes.id, parentId: s.executionNodes.parentId })
      .from(s.executionNodes)
      .where(and(eq(s.executionNodes.runId, runId), eq(s.executionNodes.branchId, branchId)));
    const parentOf = new Map<string, string | null>();
    for (const n of nodes) parentOf.set(n.id, n.parentId);

    let cursor: string | undefined = nodeId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const hit = cps.get(cursor);
      if (hit) return hit;
      const next = parentOf.get(cursor);
      cursor = next ?? undefined;
    }
    // Fallback: latest checkpoint on the branch.
    let latest: Checkpoint | undefined;
    for (const cp of cps.values()) {
      if (!latest || cp.createdAt >= latest.createdAt) latest = cp;
    }
    return latest;
  }

  private async getRunBranchCheckpointsByNode(
    runId: string,
    branchId: string,
  ): Promise<Map<string, Checkpoint>> {
    const rows = await this.db
      .select()
      .from(s.checkpoints)
      .where(and(eq(s.checkpoints.runId, runId), eq(s.checkpoints.branchId, branchId)));
    const m = new Map<string, Checkpoint>();
    for (const r of rows) m.set(r.nodeId, this.toCheckpoint(r));
    return m;
  }

  async setCheckpoint(cp: Checkpoint): Promise<void> {
    await this.db
      .insert(s.checkpoints)
      .values({
        id: cp.id,
        runId: cp.runId,
        nodeId: cp.nodeId,
        branchId: cp.branchId,
        memoryRef: cp.memoryRef,
        contextRef: cp.contextRef,
        promptRef: cp.promptRef,
        diffRef: cp.diffRef,
        fileTreeHashRef: cp.fileTreeHashRef,
        envRef: cp.envRef,
        policyRef: cp.policyRef,
        policyResolvedRef: cp.policyResolvedRef,
        auditWindowRef: cp.auditWindowRef,
        validationRef: cp.validationRef,
        parentCheckpointId: cp.parentCheckpointId,
        phoenixTraceRef: cp.phoenixTraceRef,
        memoryJson: cp.memoryJson ?? null,
        policyYaml: cp.policyYaml ?? null,
        createdAt: new Date(cp.createdAt),
      })
      .onConflictDoNothing();
  }

  // -- policy decisions --
  async setPolicyDecision(pde: PolicyDecisionEvent): Promise<void> {
    await this.db
      .insert(s.policyDecisions)
      .values({
        id: pde.eventId,
        runId: pde.runId,
        branchId: pde.branchId,
        nodeId: pde.nodeId,
        parentNodeId: pde.parentNodeId,
        checkpointId: pde.checkpointId,
        actionType: pde.actionType,
        decision: pde.decision,
        resource: pde.resource,
        normalizedResource: pde.normalizedResource,
        policyRuleId: pde.policyRuleId,
        policyRuleText: pde.policyRuleText,
        policyPath: pde.policyPath,
        reason: pde.reason,
        actor: pde.actor,
        auditLogRef: pde.auditLogRef,
        timestamp: new Date(pde.timestamp),
        rawPayloadRef: pde.rawPayloadRef,
      })
      .onConflictDoNothing();
  }

  async getRunPolicyDecisions(runId: string): Promise<PolicyDecisionEvent[]> {
    const rows = await this.db.select().from(s.policyDecisions).where(eq(s.policyDecisions.runId, runId));
    return rows.map((r) => this.toPolicyDecision(r));
  }

  async getNodePolicyDecision(
    runId: string,
    nodeId: string,
  ): Promise<PolicyDecisionEvent | undefined> {
    const rows = await this.db
      .select()
      .from(s.policyDecisions)
      .where(and(eq(s.policyDecisions.runId, runId), eq(s.policyDecisions.nodeId, nodeId)))
      .limit(1);
    return rows[0] ? this.toPolicyDecision(rows[0]) : undefined;
  }

  // -- video jobs --
  async getVideoJob(id: string): Promise<VideoJob | undefined> {
    const rows = await this.db.select().from(s.videoJobs).where(eq(s.videoJobs.id, id)).limit(1);
    const j = rows[0];
    if (!j) return undefined;
    return this.toVideoJob(j);
  }

  async setVideoJob(job: VideoJob): Promise<void> {
    await this.db
      .insert(s.videoJobs)
      .values({
        id: job.id,
        runId: job.runId,
        status: job.status,
        inputTraceRef: job.inputTraceRef,
        outputVideoRef: job.outputVideoRef,
        createdAt: new Date(job.createdAt),
        completedAt: job.completedAt ? new Date(job.completedAt) : null,
      })
      .onConflictDoUpdate({
        target: s.videoJobs.id,
        set: {
          status: job.status,
          outputVideoRef: job.outputVideoRef,
          completedAt: job.completedAt ? new Date(job.completedAt) : null,
        },
      });
  }

  async listPendingVideoJobs(): Promise<VideoJob[]> {
    const rows = await this.db.select().from(s.videoJobs).where(eq(s.videoJobs.status, "pending"));
    return rows.map((r) => this.toVideoJob(r));
  }

  // -- validations --
  async getNodeValidation(runId: string, nodeId: string): Promise<ValidationResult | undefined> {
    const rows = await this.db
      .select()
      .from(s.validationResults)
      .where(and(eq(s.validationResults.runId, runId), eq(s.validationResults.nodeId, nodeId)))
      .limit(1);
    const v = rows[0];
    if (!v) return undefined;
    return {
      id: v.id,
      runId: v.runId,
      nodeId: v.nodeId,
      status: v.status,
      failureCategory: (v.failureCategory as FailureCategory | null) ?? null,
      policyFailureCategory: (v.policyFailureCategory as PolicyFailureCategory | null) ?? null,
      confidence: v.confidence,
      evidence: (v.evidenceJson as string[]) ?? [],
      recommendedFix: v.recommendedFix,
    };
  }

  async setValidation(v: ValidationResult): Promise<void> {
    await this.db
      .insert(s.validationResults)
      .values({
        id: v.id,
        runId: v.runId,
        nodeId: v.nodeId,
        status: v.status,
        failureCategory: v.failureCategory,
        policyFailureCategory: v.policyFailureCategory,
        confidence: v.confidence,
        evidenceJson: v.evidence,
        recommendedFix: v.recommendedFix,
      })
      .onConflictDoNothing();
  }

  private toExecutionNode(r: typeof s.executionNodes.$inferSelect): ExecutionNode {
    return {
      nodeId: r.id,
      runId: r.runId,
      branchId: r.branchId,
      parentNodeId: r.parentId,
      checkpointId: r.checkpointRef,
      type: r.type as AllNodeType,
      status: r.status as NodeStatus,
      title: r.title,
      summary: r.summary,
      startedAt: r.timestampStart.toISOString(),
      endedAt: isoFromDate(r.timestampEnd),
      payloadRef: r.payloadRef,
      validationRef: r.validationRef,
    };
  }

  private toBranch(b: typeof s.branches.$inferSelect): Branch {
    return {
      id: b.id,
      runId: b.runId,
      parentBranchId: b.parentBranchId,
      forkNodeId: b.forkNodeId,
      status: b.status,
      correctionSummary: b.correctionSummary,
      createdAt: b.createdAt.toISOString(),
    };
  }

  private toCheckpoint(c: typeof s.checkpoints.$inferSelect): Checkpoint {
    return {
      id: c.id,
      runId: c.runId,
      nodeId: c.nodeId,
      branchId: c.branchId,
      memoryRef: c.memoryRef,
      contextRef: c.contextRef,
      promptRef: c.promptRef,
      diffRef: c.diffRef,
      fileTreeHashRef: c.fileTreeHashRef,
      envRef: c.envRef,
      policyRef: c.policyRef,
      policyResolvedRef: c.policyResolvedRef,
      auditWindowRef: c.auditWindowRef,
      validationRef: c.validationRef,
      parentCheckpointId: c.parentCheckpointId,
      phoenixTraceRef: c.phoenixTraceRef,
      memoryJson: (c.memoryJson as Record<string, unknown> | null) ?? null,
      policyYaml: c.policyYaml,
      createdAt: c.createdAt.toISOString(),
    };
  }

  private toPolicyDecision(p: typeof s.policyDecisions.$inferSelect): PolicyDecisionEvent {
    return {
      eventId: p.id,
      runId: p.runId,
      branchId: p.branchId,
      nodeId: p.nodeId,
      parentNodeId: p.parentNodeId,
      checkpointId: p.checkpointId,
      actionType: p.actionType as PolicyDecisionEvent["actionType"],
      decision: p.decision,
      resource: p.resource,
      normalizedResource: p.normalizedResource,
      policyRuleId: p.policyRuleId,
      policyRuleText: p.policyRuleText,
      policyPath: p.policyPath,
      reason: p.reason,
      actor: p.actor as PolicyDecisionEvent["actor"],
      auditLogRef: p.auditLogRef,
      timestamp: p.timestamp.toISOString(),
      rawPayloadRef: p.rawPayloadRef,
    };
  }

  private toVideoJob(j: typeof s.videoJobs.$inferSelect): VideoJob {
    return {
      id: j.id,
      runId: j.runId,
      status: j.status,
      inputTraceRef: j.inputTraceRef,
      outputVideoRef: j.outputVideoRef,
      createdAt: j.createdAt.toISOString(),
      completedAt: isoFromDate(j.completedAt),
    };
  }
}
