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

function makeRunner(opts: { maxIterations?: number; taskTitle?: string } = {}) {
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
      disableSnapshots: true,
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

  it("denies write_file to .env and never executes the tool", async () => {
    mockNimChat
      .mockResolvedValueOnce(toolCallMessage("write_file", { path: ".env", content: "evil" }))
      .mockResolvedValueOnce(finalMessage("ok, denied — stopped"));
    const runner = makeRunner();
    const events: RunnerEvent[] = [];
    runner.subscribe((e) => events.push(e));

    await runner.run("write .env");
    const types = events.map((e) => e.event.type);

    expect(types).toContain("policy_deny");
    expect(types).not.toContain("tool_call_start");
    expect(existsSync(path.join(sandboxRoot, ".env"))).toBe(false);

    const denyEvent = events.find((e) => e.event.type === "policy_deny")!.event as {
      attributes: Record<string, unknown>;
    };
    expect(denyEvent.attributes.actionType).toBe("file_write");
    expect(denyEvent.attributes.policyRuleId).toBe("deny_dotenv_write");

    const secondCallMessages = mockNimChat.mock.calls[1][0] as Array<{
      role: string;
      content: string | null;
    }>;
    const toolResult = secondCallMessages.find((m) => m.role === "tool");
    expect(toolResult!.content).toMatch(/denied by policy/);
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

  it("emits a checkpoint before each allowed tool call capturing the message history", async () => {
    mockNimChat
      .mockResolvedValueOnce(toolCallMessage("read_file", { path: "allowed.md" }))
      .mockResolvedValueOnce(finalMessage("done"));
    const runner = makeRunner();
    const events: RunnerEvent[] = [];
    runner.subscribe((e) => events.push(e));

    await runner.run("read allowed.md");

    const types = events.map((e) => e.event.type);
    const cpIdx = types.indexOf("checkpoint");
    const toolStartIdx = types.indexOf("tool_call_start");
    expect(cpIdx).toBeGreaterThanOrEqual(0);
    expect(toolStartIdx).toBeGreaterThan(cpIdx);

    const cpEvent = events[cpIdx].event as unknown as {
      attributes: {
        checkpointId: string;
        memory: { iteration: number; nextTool: string; nextArgs: Record<string, unknown>; messages: Array<{ role: string }> };
      };
    };
    expect(cpEvent.attributes.checkpointId).toMatch(/^cp_/);
    expect(cpEvent.attributes.memory.iteration).toBe(0);
    expect(cpEvent.attributes.memory.nextTool).toBe("read_file");
    expect(cpEvent.attributes.memory.nextArgs).toEqual({ path: "allowed.md" });
    const roles = cpEvent.attributes.memory.messages.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant"]);
  });

  it("does not emit a checkpoint for denied tool calls", async () => {
    mockNimChat
      .mockResolvedValueOnce(toolCallMessage("write_file", { path: ".env", content: "x" }))
      .mockResolvedValueOnce(finalMessage("stopped"));
    const runner = makeRunner();
    const events: RunnerEvent[] = [];
    runner.subscribe((e) => events.push(e));

    await runner.run("try .env");

    expect(events.map((e) => e.event.type)).not.toContain("checkpoint");
  });

  it("persists checkpoints to the store on completion", async () => {
    mockNimChat
      .mockResolvedValueOnce(toolCallMessage("read_file", { path: "allowed.md" }))
      .mockResolvedValueOnce(finalMessage("done"));
    const runner = makeRunner();
    await runner.run("persist cp");

    expect(store.checkpoints.size).toBe(1);
    const [cp] = [...store.checkpoints.values()];
    expect(cp.runId).toBe(runner.runId);
    expect(cp.branchId).toBe(runner.branchId);
    expect(cp.memoryJson).toMatchObject({
      iteration: 0,
      nextTool: "read_file",
      nextArgs: { path: "allowed.md" },
    });
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
