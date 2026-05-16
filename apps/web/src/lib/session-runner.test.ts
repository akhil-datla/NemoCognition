import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { InMemoryStore } from "@nemocognition/db";
import { SessionRunner, type RunnerEvent } from "./session-runner";

const mockNimChat = vi.fn();
let store: InMemoryStore;
let phoenixServer: Server;
let phoenixUrl: string;
let sandboxRoot: string;

beforeAll(async () => {
  phoenixServer = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.statusCode = 200;
      res.end();
    });
  });
  await new Promise<void>((r) => phoenixServer.listen(0, "127.0.0.1", r));
  phoenixUrl = `http://127.0.0.1:${(phoenixServer.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => phoenixServer.close(() => r())));

beforeEach(() => {
  store = new InMemoryStore();
  mockNimChat.mockReset();
  sandboxRoot = mkdtempSync(path.join(os.tmpdir(), "nemoclaw-test-"));
  writeFileSync(path.join(sandboxRoot, "allowed.md"), "research content");
});

afterEach(() => {
  rmSync(sandboxRoot, { recursive: true, force: true });
});

function makeRunner(opts: { maxIterations?: number; taskTitle?: string; maxAutoRecoveries?: number } = {}) {
  return new SessionRunner(
    {
      store,
      nimEndpoint: "http://unused",
      nimApiKey: "test",
      nimModel: "test",
      phoenixEndpoint: phoenixUrl,
      nimChat: mockNimChat,
      sandboxRoot,
      maxIterations: opts.maxIterations,
      maxAutoRecoveries: opts.maxAutoRecoveries,
    },
    opts.taskTitle ?? "test task",
    opts.taskTitle ?? "test task",
  );
}

function finalMessage(content: string) {
  return { content, tokenCount: { input: 10, output: 5 }, finishReason: "stop" };
}

function toolCallMessage(name: string, args: object, id = "call_1") {
  return {
    content: null,
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
    tokenCount: { input: 10, output: 5 },
    finishReason: "tool_calls",
  };
}

describe("SessionRunner agent loop", () => {
  it("sends system + user messages on the first NIM call", async () => {
    mockNimChat.mockResolvedValueOnce(finalMessage("hi"));
    const runner = makeRunner({ taskTitle: "ping" });
    await runner.run("ping");
    const firstMessages = mockNimChat.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(firstMessages[0].role).toBe("system");
    expect(firstMessages[0].content).toMatch(/autonomous coding agent/);
    expect(firstMessages[1].role).toBe("user");
    expect(firstMessages[1].content).toBe("ping");
  });

  it("ends in one turn when NIM returns no tool_calls", async () => {
    mockNimChat.mockResolvedValueOnce(finalMessage("hello back"));
    const runner = makeRunner();
    const events: RunnerEvent[] = [];
    runner.subscribe((e) => events.push(e));

    await runner.run("say hi");
    const types = events.map((e) => e.event.type);

    expect(mockNimChat).toHaveBeenCalledTimes(1);
    expect(types).toContain("model_call_start");
    expect(types).toContain("model_call_end");
    expect(types).not.toContain("tool_call_start");
    expect(types).not.toContain("policy_allow");
    expect(types).not.toContain("policy_deny");
    expect((events[events.length - 1].event as { status: string }).status).toBe("completed");
  });

  it("executes an allowed read_file tool call and feeds the result back", async () => {
    mockNimChat
      .mockResolvedValueOnce(toolCallMessage("read_file", { path: "allowed.md" }))
      .mockResolvedValueOnce(finalMessage("read the file, summary: research content"));
    const runner = makeRunner();
    const events: RunnerEvent[] = [];
    runner.subscribe((e) => events.push(e));

    await runner.run("read allowed.md");
    const types = events.map((e) => e.event.type);

    expect(mockNimChat).toHaveBeenCalledTimes(2);
    expect(types).toContain("policy_allow");
    expect(types).toContain("tool_call_start");
    expect(types).toContain("tool_call_end");

    const policyEvent = events.find((e) => e.event.type === "policy_allow")!.event as {
      attributes: Record<string, unknown>;
    };
    expect(policyEvent.attributes.actionType).toBe("file_read");
    expect(policyEvent.attributes.resource).toBe("allowed.md");
    expect(policyEvent.attributes.actor).toBe("nemoclaw_agent");

    const secondCallMessages = mockNimChat.mock.calls[1][0] as Array<{
      role: string;
      content: string | null;
      tool_call_id?: string;
    }>;
    const toolResult = secondCallMessages.find((m) => m.role === "tool");
    expect(toolResult).toBeDefined();
    expect(toolResult!.tool_call_id).toBe("call_1");
    expect(toolResult!.content).toMatch(/research content/);
  });

  it("auto-restores + forks a recovery branch when policy denies a tool call", async () => {
    // Turn 1: model asks to write .env (will be denied)
    // Turn 2 (on the NEW recovery branch): model completes the task safely.
    mockNimChat
      .mockResolvedValueOnce(toolCallMessage("write_file", { path: ".env", content: "evil" }))
      .mockResolvedValueOnce(finalMessage("acknowledged the rollback, finishing"));
    const runner = makeRunner();
    const events: RunnerEvent[] = [];
    runner.subscribe((e) => events.push(e));

    await runner.run("write .env please");
    const types = events.map((e) => e.event.type);

    // The violation was recorded …
    expect(types).toContain("policy_deny");
    // … no tool was ever actually run …
    expect(types).not.toContain("tool_call_start");
    expect(existsSync(path.join(sandboxRoot, ".env"))).toBe(false);
    // … a recovery branch was forked autonomously …
    expect(types).toContain("branch_start");

    const denyEvent = events.find((e) => e.event.type === "policy_deny")!.event as {
      branchId: string;
      attributes: Record<string, unknown>;
    };
    expect(denyEvent.attributes.actionType).toBe("file_write");
    expect(denyEvent.attributes.policyRuleId).toBe("deny_dotenv_write");

    const branchStart = events.find((e) => e.event.type === "branch_start")!.event as {
      branchId: string;
      parentNodeId: string;
      attributes: Record<string, unknown>;
    };
    // … on a different branch than the failed one …
    expect(branchStart.branchId).not.toBe(denyEvent.branchId);
    // … parented at the deny event (the fork point) …
    expect(branchStart.parentNodeId).toBeTruthy();
    // … carrying the failure category from classifyFailure().
    expect(branchStart.attributes.failureCategory).toBe("File Write Denied");

    // The second NIM call (the recovery turn) starts with a fresh system +
    // correction prompt — the failed branch's tool-call history is gone.
    const secondCallMessages = mockNimChat.mock.calls[1][0] as Array<{
      role: string;
      content: string | null;
    }>;
    expect(secondCallMessages[0].role).toBe("system");
    expect(secondCallMessages[1].role).toBe("user");
    expect(secondCallMessages[1].content).toMatch(/resuming from checkpoint/);
    expect(secondCallMessages[1].content).toMatch(/Policy category: File Write Denied/);
    expect(secondCallMessages.some((m) => m.role === "tool")).toBe(false);
  });

  it("actually writes files via write_file when allowed", async () => {
    mockNimChat
      .mockResolvedValueOnce(
        toolCallMessage("write_file", { path: "out.txt", content: "hello from agent" }),
      )
      .mockResolvedValueOnce(finalMessage("wrote it"));
    const runner = makeRunner();
    await runner.run("write out.txt");

    const written = readFileSync(path.join(sandboxRoot, "out.txt"), "utf8");
    expect(written).toBe("hello from agent");
  });

  it("stops at maxIterations when the model never finishes", async () => {
    mockNimChat.mockResolvedValue(
      toolCallMessage("read_file", { path: "allowed.md" }, "call_loop"),
    );
    const runner = makeRunner({ maxIterations: 3 });
    await runner.run("loop forever");
    expect(mockNimChat).toHaveBeenCalledTimes(3);
  });

  it("emits an error event and marks failed when NIM throws", async () => {
    mockNimChat.mockRejectedValueOnce(new Error("NIM down"));
    const runner = makeRunner();
    const events: RunnerEvent[] = [];
    runner.subscribe((e) => events.push(e));

    await runner.run("will fail");
    const types = events.map((e) => e.event.type);
    expect(types).toContain("error");
    expect((events[events.length - 1].event as { status: string }).status).toBe("failed");
  });

  it("persists run + nodes + policy decisions to the store", async () => {
    mockNimChat
      .mockResolvedValueOnce(toolCallMessage("read_file", { path: "allowed.md" }))
      .mockResolvedValueOnce(finalMessage("done"));
    const runner = makeRunner();
    await runner.run("persist me");

    const run = await store.getRun(runner.runId);
    expect(run).toBeDefined();
    const decisions = await store.getRunPolicyDecisions(runner.runId);
    expect(decisions.length).toBe(1);
    expect(decisions[0].decision).toBe("allow");
    expect(decisions[0].actionType).toBe("file_read");
  });

  it("restores the sandbox state across an autonomous recovery", async () => {
    // Mutate the sandbox with an allowed write so we have something to roll
    // back. Then trigger a deny. The forked branch should see the sandbox
    // restored to the post-mutation state captured by the pre_tool snapshot,
    // and the failed branch's would-be writes should never reach disk.
    mockNimChat
      .mockResolvedValueOnce(
        toolCallMessage("write_file", { path: "good.txt", content: "kept" }, "call_good"),
      )
      .mockResolvedValueOnce(
        toolCallMessage("write_file", { path: ".env", content: "evil" }, "call_evil"),
      )
      .mockResolvedValueOnce(finalMessage("recovered ok"));

    const runner = makeRunner();
    const events: RunnerEvent[] = [];
    runner.subscribe((e) => events.push(e));

    await runner.run("write some files");

    // good.txt was written before the deny and survives the rollback.
    expect(readFileSync(path.join(sandboxRoot, "good.txt"), "utf8")).toBe("kept");
    // .env was blocked.
    expect(existsSync(path.join(sandboxRoot, ".env"))).toBe(false);

    const branchStartEvents = events.filter((e) => e.event.type === "branch_start");
    expect(branchStartEvents.length).toBe(1);

    // Once a deny fires, no further policy_allow or tool_call_start should
    // exist on the FAILED branch — they should all live on the new branch.
    const denyEvent = events.find((e) => e.event.type === "policy_deny")!.event as {
      branchId: string;
    };
    const eventsAfterDeny = events.slice(events.findIndex((e) => e.event === denyEvent) + 1);
    const failedBranchActionsAfterDeny = eventsAfterDeny.filter(
      (e) =>
        "branchId" in e.event &&
        e.event.branchId === denyEvent.branchId &&
        (e.event.type === "tool_call_start" ||
          e.event.type === "model_call_start" ||
          e.event.type === "policy_allow"),
    );
    expect(failedBranchActionsAfterDeny.length).toBe(0);
  });

  it("falls back to the deny-tool-message after exhausting the recovery budget", async () => {
    // Three denies in a row — with maxAutoRecoveries=1 only the first one
    // triggers a fork; the second falls through to feeding the deny back to
    // the model, and the model wraps up.
    mockNimChat
      .mockResolvedValueOnce(
        toolCallMessage("write_file", { path: ".env", content: "evil1" }, "call_1"),
      )
      .mockResolvedValueOnce(
        toolCallMessage("write_file", { path: ".env", content: "evil2" }, "call_2"),
      )
      .mockResolvedValueOnce(finalMessage("giving up, no .env"));

    const runner = makeRunner({ maxAutoRecoveries: 1 });
    const events: RunnerEvent[] = [];
    runner.subscribe((e) => events.push(e));

    await runner.run("keep trying .env");
    const types = events.map((e) => e.event.type);
    const branchStarts = types.filter((t) => t === "branch_start").length;
    expect(branchStarts).toBe(1);
    // The third NIM call sees a tool message on the post-budget deny.
    const thirdCallMessages = mockNimChat.mock.calls[2][0] as Array<{
      role: string;
      content: string | null;
    }>;
    expect(thirdCallMessages.some((m) => m.role === "tool" && /denied by policy/.test(m.content ?? ""))).toBe(true);
  });

  it("seq is monotonically increasing", async () => {
    mockNimChat.mockResolvedValueOnce(finalMessage("ok"));
    const runner = makeRunner();
    const events: RunnerEvent[] = [];
    runner.subscribe((e) => events.push(e));
    await runner.run("seq");
    for (let i = 1; i < events.length; i++) {
      expect(events[i].seq).toBe(events[i - 1].seq + 1);
    }
  });
});
