import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionRecorder, type RecorderConfig } from "./recorder";

describe("SessionRecorder", () => {
  let recorder: SessionRecorder;
  let mockNimChat: ReturnType<typeof vi.fn>;
  let spansSent: unknown[];

  beforeEach(() => {
    spansSent = [];
    mockNimChat = vi.fn().mockResolvedValue({
      content: "I'll help with that research task.",
      tokenCount: { input: 50, output: 20 },
      finishReason: "stop",
    });

    recorder = new SessionRecorder({
      nimEndpoint: "https://integrate.api.nvidia.com/v1",
      nimApiKey: "nvapi-test",
      nimModel: "nvidia/llama-3.1-nemotron-70b-instruct",
      phoenixEndpoint: "http://localhost:4317",
      onSpanExport: (spans) => spansSent.push(...spans),
      nimChat: mockNimChat,
    });
  });

  it("starts a session and returns a run ID", () => {
    const session = recorder.start({
      title: "Research report",
      userTask: "Create report from allowed docs",
    });

    expect(session.runId).toBeTruthy();
    expect(session.branchId).toBeTruthy();
  });

  it("records a model call through the agent loop", async () => {
    const session = recorder.start({ title: "Test", userTask: "test" });
    const result = await session.chat("Hello, help me research scaling laws.");

    expect(mockNimChat).toHaveBeenCalledOnce();
    expect(result.content).toBe("I'll help with that research task.");
    expect(result.tokenCount.input).toBe(50);
  });

  it("registers and executes tools during a session", async () => {
    const session = recorder.start({ title: "Test", userTask: "test" });

    session.registerTool({
      name: "read_file",
      description: "Read a file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
      execute: async (args) => ({ content: `file contents of ${args.path}` }),
    });

    const result = await session.executeTool("read_file", { path: "./research/paper.md" });
    expect(result.exitCode).toBe(0);
    expect(result.output).toEqual({ content: "file contents of ./research/paper.md" });
  });

  it("records policy decisions", () => {
    const session = recorder.start({ title: "Test", userTask: "test" });

    session.recordPolicy({
      actionType: "file_read",
      decision: "deny",
      resource: "./private/keys.txt",
      normalizedResource: "./private/**",
      policyRuleId: "rule_1",
      policyRuleText: "deny_read: ./private/**",
      policyPath: "files.deny_read[0]",
      reason: "Matches deny pattern",
      actor: "openshell",
    });

    const spans = session.exportSpans();
    const policySpan = spans.find((s: { type: string }) => s.type === "policy_deny");
    expect(policySpan).toBeDefined();
  });

  it("creates checkpoints during a session", () => {
    const session = recorder.start({ title: "Test", userTask: "test" });
    const cpId = session.checkpoint({
      memory: { findings: "scaling laws" },
      policyYaml: "files:\n  allow_read:\n    - ./research/**",
    });
    expect(cpId).toBeTruthy();
  });

  it("ends a session and exports all spans", () => {
    const session = recorder.start({ title: "Test", userTask: "test" });
    session.end("completed");

    const spans = session.exportSpans();
    expect(spans.length).toBeGreaterThanOrEqual(2);
    expect(spans[0].provider).toBe("nvidia");
    expect(spans[0].model).toBe("nemotron");

    const endSpan = spans.find((s: { type: string }) => s.type === "run_end");
    expect(endSpan).toBeDefined();
  });

  it("exports spans to Phoenix via callback", async () => {
    const session = recorder.start({ title: "Test", userTask: "test" });
    await session.chat("Hello");
    session.end("completed");
    session.flush();

    expect(spansSent.length).toBeGreaterThan(0);
  });

  describe("flushToBackends (with real local HTTP servers)", () => {
    const { createServer } = require("node:http") as typeof import("node:http");
    type AddressInfo = import("node:net").AddressInfo;

    async function withServers(
      handlers: { phoenix?: (path: string) => number; api?: (path: string) => number },
    ): Promise<{
      phoenixUrl: string;
      apiUrl: string;
      apiHits: string[];
      phoenixHits: string[];
      close: () => Promise<void>;
    }> {
      const phoenixHits: string[] = [];
      const apiHits: string[] = [];
      const ph = createServer((req, res) => {
        phoenixHits.push(req.url ?? "");
        req.on("data", () => {});
        req.on("end", () => {
          res.statusCode = handlers.phoenix?.(req.url ?? "") ?? 200;
          res.end();
        });
      });
      const api = createServer((req, res) => {
        apiHits.push(req.url ?? "");
        req.on("data", () => {});
        req.on("end", () => {
          res.statusCode = handlers.api?.(req.url ?? "") ?? 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
        });
      });
      await new Promise<void>((r) => ph.listen(0, "127.0.0.1", r));
      await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
      const phPort = (ph.address() as AddressInfo).port;
      const apiPort = (api.address() as AddressInfo).port;
      return {
        phoenixUrl: `http://127.0.0.1:${phPort}`,
        apiUrl: `http://127.0.0.1:${apiPort}`,
        phoenixHits,
        apiHits,
        close: async () => {
          await new Promise<void>((r) => ph.close(() => r()));
          await new Promise<void>((r) => api.close(() => r()));
        },
      };
    }

    it("posts OTLP to Phoenix and import to API when both configured", async () => {
      const ctx = await withServers({});
      const r = new SessionRecorder({
        nimEndpoint: "x",
        nimApiKey: "x",
        nimModel: "x",
        phoenixEndpoint: ctx.phoenixUrl,
        nemocognitionApiUrl: ctx.apiUrl,
        nimChat: mockNimChat,
      });
      const session = r.start({ title: "T", userTask: "t" });
      session.end("completed");
      const result = await session.flushToBackends();
      expect(result.phoenix.ok).toBe(true);
      expect(result.api.ok).toBe(true);
      expect(result.api.skipped).toBeUndefined();
      expect(ctx.phoenixHits).toContain("/v1/traces");
      expect(ctx.apiHits).toContain("/api/runs/import");
      await ctx.close();
    });

    it("skips API when nemocognitionApiUrl unset", async () => {
      const ctx = await withServers({});
      const r = new SessionRecorder({
        nimEndpoint: "x",
        nimApiKey: "x",
        nimModel: "x",
        phoenixEndpoint: ctx.phoenixUrl,
        nimChat: mockNimChat,
      });
      const session = r.start({ title: "T", userTask: "t" });
      session.end("completed");
      const result = await session.flushToBackends();
      expect(result.api.skipped).toBe(true);
      await ctx.close();
    });

    it("retries the API import on transient 5xx (succeeds on 3rd attempt)", async () => {
      let apiCalls = 0;
      const ctx = await withServers({
        api: () => {
          apiCalls += 1;
          return apiCalls < 3 ? 503 : 200;
        },
      });
      const r = new SessionRecorder({
        nimEndpoint: "x",
        nimApiKey: "x",
        nimModel: "x",
        phoenixEndpoint: ctx.phoenixUrl,
        nemocognitionApiUrl: ctx.apiUrl,
        nimChat: mockNimChat,
      });
      const session = r.start({ title: "T", userTask: "t" });
      session.end("completed");
      const result = await session.flushToBackends();
      expect(result.api.ok).toBe(true);
      expect(apiCalls).toBe(3);
      await ctx.close();
    }, 10000);

    it("does not retry the API import on 4xx (permanent)", async () => {
      let apiCalls = 0;
      const ctx = await withServers({
        api: () => {
          apiCalls += 1;
          return 400;
        },
      });
      const r = new SessionRecorder({
        nimEndpoint: "x",
        nimApiKey: "x",
        nimModel: "x",
        phoenixEndpoint: ctx.phoenixUrl,
        nemocognitionApiUrl: ctx.apiUrl,
        nimChat: mockNimChat,
      });
      const session = r.start({ title: "T", userTask: "t" });
      session.end("completed");
      const result = await session.flushToBackends();
      expect(result.api.ok).toBe(false);
      expect(apiCalls).toBe(1);
      await ctx.close();
    });

    it("does not throw when Phoenix returns 5xx (OTel SDK swallows transient errors)", async () => {
      const ctx = await withServers({ phoenix: () => 500 });
      const r = new SessionRecorder({
        nimEndpoint: "x",
        nimApiKey: "x",
        nimModel: "x",
        phoenixEndpoint: ctx.phoenixUrl,
        nimChat: mockNimChat,
      });
      const session = r.start({ title: "T", userTask: "t" });
      session.end("completed");
      // The OTel SDK retries and logs errors to console but doesn't propagate
      // them via forceFlush/shutdown. The important contract is that the
      // recording session itself still completes — the user can debug a
      // broken Phoenix by checking its container logs.
      await expect(session.flushToBackends()).resolves.toBeDefined();
      await ctx.close();
    });
  });
});
