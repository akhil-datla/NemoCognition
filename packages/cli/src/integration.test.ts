import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionRecorder } from "./recorder";
import { InMemoryStore } from "@nemocognition/db";
import {
  handleImportRun,
  handleGetGraph,
  handleGetRun,
  handleGetRunPolicy,
} from "../../../apps/web/src/app/api/handlers";
import { traceToStoryboard } from "@nemocognition/video";

describe("End-to-end: CLI recorder → API import → graph + storyboard", () => {
  let store: InMemoryStore;
  let fetchMock: ReturnType<typeof vi.fn>;
  let mockNimChat: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new InMemoryStore();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    mockNimChat = vi.fn().mockResolvedValue({
      content: "I'll handle that.",
      tokenCount: { input: 20, output: 10 },
      finishReason: "stop",
    });
  });

  it("records a session, ingests via the API handler, and produces a queryable graph", async () => {
    const recorder = new SessionRecorder({
      nimEndpoint: "x",
      nimApiKey: "x",
      nimModel: "x",
      phoenixEndpoint: "http://phoenix:6006",
      nimChat: mockNimChat,
      fetch: fetchMock,
    });

    const session = recorder.start({
      title: "Integration test",
      userTask: "Test the full pipeline",
    });

    await session.chat("First question");

    session.registerTool({
      name: "read_file",
      description: "Read a file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
      execute: async (a) => ({ content: `Contents of ${a.path}` }),
    });
    await session.executeTool("read_file", { path: "./allowed/file.md" });

    session.recordPolicy({
      actionType: "file_read",
      decision: "allow",
      resource: "./allowed/file.md",
      normalizedResource: "./allowed/**",
      policyRuleId: "rule_1",
      policyRuleText: "allow_read",
      policyPath: "files.allow_read[0]",
      reason: "matches allow",
      actor: "openshell",
    });

    session.recordPolicy({
      actionType: "file_read",
      decision: "deny",
      resource: "./private/secret.txt",
      normalizedResource: "./private/**",
      policyRuleId: "rule_2",
      policyRuleText: "deny_read",
      policyPath: "files.deny_read[0]",
      reason: "matches deny",
      actor: "openshell",
    });

    const cpId = session.checkpoint({ memory: { step: "x" }, policyYaml: "" });
    expect(cpId).toBeTruthy();

    session.captureMemory("findings", "policy violation observed");
    session.end("failed");

    const events = session.getEvents();
    expect(events.length).toBeGreaterThan(8);

    // Import via API handler (the path a real CLI would take over HTTP).
    const importResult = await handleImportRun(store, { events });
    expect(importResult.status).toBe(201);

    // Query the run through the API.
    const runResult = await handleGetRun(store, session.runId);
    expect(runResult.status).toBe(200);
    const run = runResult.body as { status: string };
    expect(run.status).toBe("failed");

    // Query the graph.
    const graphResult = await handleGetGraph(store, session.runId);
    expect(graphResult.status).toBe(200);
    const graph = graphResult.body as { nodes: unknown[]; edges: unknown[]; branches: string[] };
    expect(graph.nodes.length).toBeGreaterThan(4);

    // Policy decisions surfaced.
    const policyResult = await handleGetRunPolicy(store, session.runId);
    const policy = policyResult.body as { decisions: Array<{ decision: string }> };
    expect(policy.decisions).toHaveLength(2);
    expect(policy.decisions.map((d) => d.decision).sort()).toEqual(["allow", "deny"]);

    // Storyboard reflects the climactic policy_deny scene.
    const nodes = await store.getRunNodes(session.runId);
    const storyboard = traceToStoryboard(nodes, { runId: session.runId, title: "Integration test" });
    const climactic = storyboard.scenes.filter((s) => s.isClimactic);
    expect(climactic.length).toBeGreaterThan(0);
  });

  it("flushToBackends sends OTLP and posts import to live local servers", async () => {
    const { createServer } = await import("node:http");
    const phoenixHits: string[] = [];
    const apiHits: string[] = [];
    const ph = createServer((req, res) => {
      phoenixHits.push(req.url ?? "");
      req.on("data", () => {});
      req.on("end", () => { res.statusCode = 200; res.end(); });
    });
    const api = createServer((req, res) => {
      apiHits.push(req.url ?? "");
      req.on("data", () => {});
      req.on("end", () => { res.statusCode = 200; res.setHeader("Content-Type", "application/json"); res.end("{}"); });
    });
    await new Promise<void>((r) => ph.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
    type AI = import("node:net").AddressInfo;
    const phUrl = `http://127.0.0.1:${(ph.address() as AI).port}`;
    const apiUrl = `http://127.0.0.1:${(api.address() as AI).port}`;

    try {
      const recorder = new SessionRecorder({
        nimEndpoint: "x",
        nimApiKey: "x",
        nimModel: "x",
        phoenixEndpoint: phUrl,
        nemocognitionApiUrl: apiUrl,
        nimChat: mockNimChat,
      });
      const session = recorder.start({ title: "T", userTask: "t" });
      await session.chat("test");
      session.end("completed");

      const flush = await session.flushToBackends();
      expect(flush.phoenix.ok).toBe(true);
      expect(flush.api.ok).toBe(true);
      expect(phoenixHits).toContain("/v1/traces");
      expect(apiHits).toContain("/api/runs/import");
    } finally {
      await new Promise<void>((r) => ph.close(() => r()));
      await new Promise<void>((r) => api.close(() => r()));
    }
  });

  it("Phoenix exporter produces a valid OTLP envelope (verified via buildOtlpEnvelope)", async () => {
    const { buildOtlpEnvelope } = await import("@nemocognition/tracing");
    const recorder = new SessionRecorder({
      nimEndpoint: "x",
      nimApiKey: "x",
      nimModel: "x",
      phoenixEndpoint: "http://unused",
      nimChat: mockNimChat,
      fetch: fetchMock,
    });
    const session = recorder.start({ title: "T", userTask: "t" });
    await session.chat("test");
    session.end("completed");

    // The exporter's wire format is verified separately in
    // phoenix-client.test.ts via a real HTTP server. Here we just confirm
    // the recorder's events produce a valid envelope shape with hex IDs.
    const envelope = buildOtlpEnvelope(session.getEvents(), { serviceName: "test" });
    const span = envelope.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
  });
});
