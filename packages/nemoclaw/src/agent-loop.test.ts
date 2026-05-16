import { describe, it, expect, vi } from "vitest";
import { AgentLoop, type AgentTool, type SessionLike, type Snapshotter, type AgentSnapshotResult } from "./agent-loop";

/** Build a fake snapshotter that returns deterministic artifact metadata and records extract calls. */
function makeFakeSnapshotter(): Snapshotter & {
  snapshotCalls: { kind: string; nodeId: string }[];
  extractCalls: { artifactPath: string; destDir: string }[];
} {
  const snapshotCalls: { kind: string; nodeId: string }[] = [];
  const extractCalls: { artifactPath: string; destDir: string }[] = [];
  let counter = 0;
  return {
    snapshotCalls,
    extractCalls,
    async snapshot(input): Promise<AgentSnapshotResult> {
      counter += 1;
      snapshotCalls.push({ kind: input.kind, nodeId: input.nodeId });
      return {
        cpId: `cp_${counter}`,
        artifactPath: `/tmp/${input.kind}_${counter}.tar`,
        manifestPath: `/tmp/${input.kind}_${counter}.json`,
        checksum: `sha_${counter}`,
        fileCount: counter,
      };
    },
    async extract(artifactPath, destDir) {
      extractCalls.push({ artifactPath, destDir });
    },
  };
}

/** A minimal SessionLike that records every call and tracks branch state. */
function makeFakeSession(opts: {
  chat: ReturnType<typeof vi.fn>;
  initialBranchId?: string;
}): SessionLike & {
  policyCalls: { actionType: string; decision: string; ruleId: string }[];
  toolCalls: { name: string; args: Record<string, unknown> }[];
  checkpoints: { kind?: string }[];
  forks: { parentBranchId: string; forkNodeId: string }[];
  endStatus: string | null;
  nodeCounter: number;
  lastNode: string | null;
} {
  let branchId = opts.initialBranchId ?? "branch_main";
  const runId = "run_test";
  let nodeCounter = 0;
  let lastNode: string | null = null;
  const next = () => {
    nodeCounter += 1;
    const id = `node_${nodeCounter}`;
    lastNode = id;
    return id;
  };
  const policyCalls: { actionType: string; decision: string; ruleId: string }[] = [];
  const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
  const checkpoints: { kind?: string }[] = [];
  const forks: { parentBranchId: string; forkNodeId: string }[] = [];
  let endStatus: string | null = null;
  return {
    get runId() {
      return runId;
    },
    get branchId() {
      return branchId;
    },
    get policyCalls() {
      return policyCalls;
    },
    get toolCalls() {
      return toolCalls;
    },
    get checkpoints() {
      return checkpoints;
    },
    get forks() {
      return forks;
    },
    get endStatus() {
      return endStatus;
    },
    get nodeCounter() {
      return nodeCounter;
    },
    get lastNode() {
      return lastNode;
    },
    registerTool() {
      /* no-op */
    },
    async chatMessages(messages, options) {
      next(); // model_call_start
      const resp = await opts.chat(messages, options);
      next(); // model_call_end
      return resp;
    },
    async executeTool(name, args) {
      toolCalls.push({ name, args });
      next();
      return { toolName: name, output: { ok: true }, exitCode: 0, durationMs: 1, errorClass: null, filesTouched: [] };
    },
    recordPolicy(input) {
      policyCalls.push({ actionType: input.actionType, decision: input.decision, ruleId: input.policyRuleId });
      next();
    },
    checkpoint(input) {
      checkpoints.push({ kind: input.kind });
      const id = next();
      return id;
    },
    forkInto(input) {
      forks.push({ parentBranchId: input.parentBranchId, forkNodeId: input.forkNodeId });
      branchId = input.branchId ?? `branch_recovery_${forks.length}`;
      next(); // branch_start
      return { runId: input.runId, branchId };
    },
    getLastNodeId() {
      return lastNode;
    },
    end(status) {
      endStatus = status;
    },
  };
}

const writeFileTool: AgentTool = {
  name: "write_file",
  description: "Write a file",
  actionType: "file_write",
  parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
  resourceFromArgs: (a) => String(a.path ?? ""),
  execute: async () => ({ ok: true }),
};

const readFileTool: AgentTool = {
  name: "read_file",
  description: "Read a file",
  actionType: "file_read",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  resourceFromArgs: (a) => String(a.path ?? ""),
  execute: async () => ({ ok: true }),
};

function toolCallResp(name: string, args: Record<string, unknown>, id = "call_1") {
  return {
    content: null,
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
    tokenCount: { input: 1, output: 1 },
  };
}

function finalResp(content: string) {
  return { content, tokenCount: { input: 1, output: 1 } };
}

describe("AgentLoop", () => {
  it("policy_deny → autonomous restore + fork + correction prompt on next turn", async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce(toolCallResp("write_file", { path: ".env", content: "x" }))
      .mockResolvedValueOnce(finalResp("done after recovery"));

    const session = makeFakeSession({ chat });
    const snapshotter = makeFakeSnapshotter();
    const forkPersist = vi.fn(async () => {});

    const loop = new AgentLoop({
      session,
      tools: [writeFileTool, readFileTool],
      sandboxRoot: "/tmp/sandbox-fake",
      snapshotter,
      onBranchFork: forkPersist,
    });

    const result = await loop.run("write .env");

    expect(result.status).toBe("completed");
    expect(result.autoRecoveriesUsed).toBe(1);
    // .env was never executed
    expect(session.toolCalls.length).toBe(0);
    // exactly one policy_deny then no further policy calls on the failed branch
    expect(session.policyCalls.map((p) => p.decision)).toEqual(["deny"]);
    expect(session.policyCalls[0].ruleId).toBe("deny_dotenv_write");
    // exactly one fork happened
    expect(session.forks.length).toBe(1);
    expect(forkPersist).toHaveBeenCalledOnce();
    // snapshotter extracted to restore the sandbox
    expect(snapshotter.extractCalls.length).toBe(1);
    expect(snapshotter.extractCalls[0].destDir).toBe("/tmp/sandbox-fake");
    // second NIM turn started fresh: system + correction prompt only
    const secondTurn = chat.mock.calls[1][0] as Array<{ role: string; content: string }>;
    expect(secondTurn[0].role).toBe("system");
    expect(secondTurn[1].role).toBe("user");
    expect(secondTurn[1].content).toMatch(/resuming from checkpoint/);
    expect(secondTurn[1].content).toMatch(/Policy category: File Write Denied/);
    expect(secondTurn.some((m) => m.role === "tool")).toBe(false);
  });

  it("falls back to deny-message after maxAutoRecoveries", async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce(toolCallResp("write_file", { path: ".env", content: "1" }, "c1"))
      .mockResolvedValueOnce(toolCallResp("write_file", { path: ".env", content: "2" }, "c2"))
      .mockResolvedValueOnce(finalResp("giving up"));

    const session = makeFakeSession({ chat });
    const snapshotter = makeFakeSnapshotter();

    const loop = new AgentLoop({
      session,
      tools: [writeFileTool],
      sandboxRoot: "/tmp/sandbox-fake",
      snapshotter,
      maxAutoRecoveries: 1,
    });

    await loop.run("loop");
    expect(session.forks.length).toBe(1);
    const thirdTurn = chat.mock.calls[2][0] as Array<{ role: string; content: string | null }>;
    expect(thirdTurn.some((m) => m.role === "tool" && /denied by policy/.test(m.content ?? ""))).toBe(true);
  });

  it("ends in one turn when no tool calls and emits final snapshot", async () => {
    const chat = vi.fn().mockResolvedValueOnce(finalResp("hi"));
    const session = makeFakeSession({ chat });
    const snapshotter = makeFakeSnapshotter();

    const loop = new AgentLoop({
      session,
      tools: [readFileTool],
      sandboxRoot: "/tmp/sandbox-fake",
      snapshotter,
    });

    const result = await loop.run("ping");
    expect(result.status).toBe("completed");
    expect(session.endStatus).toBe("completed");
    expect(session.toolCalls.length).toBe(0);
    // baseline + final
    const kinds = snapshotter.snapshotCalls.map((s) => s.kind);
    expect(kinds).toContain("manual");
    expect(kinds).toContain("final");
  });
});
