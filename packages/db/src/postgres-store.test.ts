import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";
import { PostgresStore } from "./postgres-store";
import type {
  Run,
  ExecutionNode,
  Branch,
  PolicyDecisionEvent,
  Checkpoint,
  VideoJob,
} from "@nemocognition/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;
let store: PostgresStore;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });

  // Apply ALL generated migration SQL files in order (drizzle-orm migrator
  // targets postgres-js; for pglite we just exec each statement).
  const drizzleDir = resolve(__dirname, "..", "drizzle");
  const files = readdirSync(drizzleDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const ddl = readFileSync(resolve(drizzleDir, file), "utf8");
    const statements = ddl.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await pg.exec(stmt);
    }
  }
  // Cast through unknown: PgliteDatabase and PostgresJsDatabase are
  // structurally compatible for the methods PostgresStore uses, but TS treats
  // them as distinct nominal types.
  store = new PostgresStore(db as unknown as import("./client").Database);
});

beforeEach(async () => {
  // Truncate everything before each test to keep them isolated.
  for (const table of [
    "audit_events",
    "policy_decisions",
    "trace_span_refs",
    "video_jobs",
    "validation_results",
    "checkpoints",
    "execution_nodes",
    "branches",
    "runs",
  ]) {
    await pg.exec(`DELETE FROM "${table}"`);
  }
});

function makeRun(id: string, status: Run["status"] = "running"): Run {
  return {
    id,
    title: `Run ${id}`,
    userTask: "task",
    status,
    createdAt: "2026-05-15T10:00:00.000Z",
    completedAt: null,
    rootBranchId: "b_root",
  };
}

function makeBranch(id: string, runId: string): Branch {
  return {
    id,
    runId,
    parentBranchId: null,
    forkNodeId: null,
    status: "running",
    correctionSummary: null,
    createdAt: "2026-05-15T10:00:00.000Z",
  };
}

function makeNode(nodeId: string, runId: string, branchId: string): ExecutionNode {
  return {
    nodeId,
    runId,
    branchId,
    parentNodeId: null,
    checkpointId: null,
    type: "agent_message",
    status: "success",
    title: "node",
    summary: "n",
    startedAt: "2026-05-15T10:00:00.000Z",
    endedAt: null,
    payloadRef: null,
    validationRef: null,
  };
}

describe("PostgresStore", () => {
  it("ping returns true on a live connection", async () => {
    expect(await store.ping()).toBe(true);
  });

  it("round-trips a run via setRun/getRun", async () => {
    const run = makeRun("run_a", "running");
    await store.setRun(run);
    const fetched = await store.getRun("run_a");
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe("run_a");
    expect(fetched!.status).toBe("running");
  });

  it("setRun upserts (updates status on conflict)", async () => {
    await store.setRun(makeRun("run_b", "running"));
    await store.setRun({
      ...makeRun("run_b"),
      status: "completed",
      completedAt: "2026-05-15T10:05:00.000Z",
    });
    const fetched = await store.getRun("run_b");
    expect(fetched!.status).toBe("completed");
    expect(fetched!.completedAt).toBe("2026-05-15T10:05:00.000Z");
  });

  it("getAllRuns returns all rows", async () => {
    await store.setRun(makeRun("r1"));
    await store.setRun(makeRun("r2"));
    const all = await store.getAllRuns();
    expect(all.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });

  it("round-trips branches and filters by run", async () => {
    await store.setRun(makeRun("rx"));
    await store.setRun(makeRun("ry"));
    await store.setBranch(makeBranch("b_x1", "rx"));
    await store.setBranch(makeBranch("b_x2", "rx"));
    await store.setBranch(makeBranch("b_y1", "ry"));
    const xs = await store.getRunBranches("rx");
    expect(xs.map((b) => b.id).sort()).toEqual(["b_x1", "b_x2"]);
  });

  it("round-trips nodes and getRunNodes filters by run", async () => {
    await store.setRun(makeRun("rn"));
    await store.setBranch(makeBranch("b_n", "rn"));
    await store.setNode(makeNode("n1", "rn", "b_n"));
    await store.setNode(makeNode("n2", "rn", "b_n"));
    const nodes = await store.getRunNodes("rn");
    expect(nodes).toHaveLength(2);
    const single = await store.getNode("n1");
    expect(single!.title).toBe("node");
  });

  it("upserts a node and updates status on conflict", async () => {
    await store.setRun(makeRun("ru"));
    await store.setBranch(makeBranch("b_u", "ru"));
    await store.setNode(makeNode("n_u", "ru", "b_u"));
    await store.setNode({
      ...makeNode("n_u", "ru", "b_u"),
      status: "failure",
      summary: "boom",
      endedAt: "2026-05-15T10:01:00.000Z",
    });
    const fetched = await store.getNode("n_u");
    expect(fetched!.status).toBe("failure");
    expect(fetched!.summary).toBe("boom");
    expect(fetched!.endedAt).toBe("2026-05-15T10:01:00.000Z");
  });

  it("stores policy decisions and queries by run + node", async () => {
    await store.setRun(makeRun("rp"));
    await store.setBranch(makeBranch("b_p", "rp"));
    const pde: PolicyDecisionEvent = {
      eventId: "pde_1",
      runId: "rp",
      branchId: "b_p",
      nodeId: "n_p",
      parentNodeId: null,
      checkpointId: null,
      actionType: "file_read",
      decision: "deny",
      resource: "/x",
      normalizedResource: "/x",
      policyRuleId: "r",
      policyRuleText: "r",
      policyPath: "p",
      reason: "match",
      actor: "openshell",
      auditLogRef: "audit/x",
      timestamp: "2026-05-15T10:00:00.000Z",
      rawPayloadRef: "payload/x",
    };
    await store.setPolicyDecision(pde);
    const byRun = await store.getRunPolicyDecisions("rp");
    expect(byRun).toHaveLength(1);
    expect(byRun[0].decision).toBe("deny");

    const byNode = await store.getNodePolicyDecision("rp", "n_p");
    expect(byNode!.eventId).toBe("pde_1");
  });

  it("findNearestCheckpointBeforeNode walks parent chain to find the resume point", async () => {
    await store.setRun(makeRun("rwalk"));
    await store.setBranch(makeBranch("b_walk", "rwalk"));
    // node chain: n1 (cp_a) -> n2 -> n3 (cp_b) -> n4 -> n5 (failed)
    const mk = (id: string, parent: string | null) =>
      store.setNode({ ...makeNode(id, "rwalk", "b_walk"), parentNodeId: parent });
    await mk("n1", null);
    await mk("n2", "n1");
    await mk("n3", "n2");
    await mk("n4", "n3");
    await mk("n5", "n4");
    await store.setCheckpoint({
      id: "cp_a", runId: "rwalk", nodeId: "n1", branchId: "b_walk",
      memoryRef: null, contextRef: null, promptRef: null, diffRef: null,
      fileTreeHashRef: null, envRef: null, policyRef: null, policyResolvedRef: null,
      auditWindowRef: null, validationRef: null, parentCheckpointId: null, phoenixTraceRef: null,
      memoryJson: { stage: "a" }, policyYaml: "a",
      createdAt: "2026-05-15T10:00:00.000Z",
    });
    await store.setCheckpoint({
      id: "cp_b", runId: "rwalk", nodeId: "n3", branchId: "b_walk",
      memoryRef: null, contextRef: null, promptRef: null, diffRef: null,
      fileTreeHashRef: null, envRef: null, policyRef: null, policyResolvedRef: null,
      auditWindowRef: null, validationRef: null, parentCheckpointId: null, phoenixTraceRef: null,
      memoryJson: { stage: "b" }, policyYaml: "b",
      createdAt: "2026-05-15T10:00:01.000Z",
    });
    // From n5, the nearest ancestor with a checkpoint is n3 (cp_b).
    const found = await store.findNearestCheckpointBeforeNode("rwalk", "b_walk", "n5");
    expect(found?.id).toBe("cp_b");
  });

  it("findNearestCheckpointBeforeNode falls back to the latest branch checkpoint when ancestors have none", async () => {
    await store.setRun(makeRun("rwalk2"));
    await store.setBranch(makeBranch("b_walk2", "rwalk2"));
    await store.setNode({ ...makeNode("only", "rwalk2", "b_walk2"), parentNodeId: null });
    await store.setCheckpoint({
      id: "cp_fallback", runId: "rwalk2", nodeId: "disconnected", branchId: "b_walk2",
      memoryRef: null, contextRef: null, promptRef: null, diffRef: null,
      fileTreeHashRef: null, envRef: null, policyRef: null, policyResolvedRef: null,
      auditWindowRef: null, validationRef: null, parentCheckpointId: null, phoenixTraceRef: null,
      memoryJson: null, policyYaml: null,
      createdAt: "2026-05-15T10:00:00.000Z",
    });
    const found = await store.findNearestCheckpointBeforeNode("rwalk2", "b_walk2", "only");
    expect(found?.id).toBe("cp_fallback");
  });

  it("stores checkpoints with inline memoryJson and policyYaml", async () => {
    await store.setRun(makeRun("rc"));
    const cp: Checkpoint = {
      id: "cp_1",
      runId: "rc",
      nodeId: "n_c",
      branchId: "b_c",
      memoryRef: "m",
      contextRef: null,
      promptRef: null,
      diffRef: null,
      fileTreeHashRef: null,
      envRef: null,
      policyRef: null,
      policyResolvedRef: null,
      auditWindowRef: null,
      validationRef: null,
      parentCheckpointId: null,
      phoenixTraceRef: null,
      memoryJson: { findings: "scaling laws", step: 3 },
      policyYaml: "files:\n  allow_read:\n    - ./research/**",
      createdAt: "2026-05-15T10:00:00.000Z",
    };
    await store.setCheckpoint(cp);
    const fetched = await store.getCheckpoint("cp_1");
    expect(fetched).toBeDefined();
    expect(fetched!.memoryRef).toBe("m");
    expect(fetched!.memoryJson).toEqual({ findings: "scaling laws", step: 3 });
    expect(fetched!.policyYaml).toContain("allow_read");
  });

  it("video jobs round-trip and listPending filters by status", async () => {
    await store.setRun(makeRun("rv"));
    const jPending: VideoJob = {
      id: "vj_p",
      runId: "rv",
      status: "pending",
      inputTraceRef: "phoenix/rv",
      outputVideoRef: null,
      createdAt: "2026-05-15T10:00:00.000Z",
      completedAt: null,
    };
    const jDone: VideoJob = {
      id: "vj_d",
      runId: "rv",
      status: "completed",
      inputTraceRef: "phoenix/rv",
      outputVideoRef: "s3://x",
      createdAt: "2026-05-15T10:00:00.000Z",
      completedAt: "2026-05-15T10:01:00.000Z",
    };
    await store.setVideoJob(jPending);
    await store.setVideoJob(jDone);
    const pending = await store.listPendingVideoJobs();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("vj_p");
  });
});
