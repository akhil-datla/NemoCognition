import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { PhoenixExporter, buildOtlpEnvelope } from "./phoenix-client";
import type { TrackerEvent } from "@nemocognition/nemoclaw";

function makeEvent(overrides: Partial<TrackerEvent> = {}): TrackerEvent {
  return {
    type: "run_start",
    runId: "run_abc",
    branchId: "branch_abc",
    nodeId: "node_1",
    parentNodeId: null,
    timestamp: "2026-05-15T10:00:00.000Z",
    attributes: { provider: "nvidia", model: "nemotron" },
    ...overrides,
  };
}

describe("buildOtlpEnvelope", () => {
  it("returns a valid OTLP/HTTP envelope shape", () => {
    const env = buildOtlpEnvelope([makeEvent()], { serviceName: "nemocognition" });
    expect(env.resourceSpans).toBeDefined();
    expect(env.resourceSpans).toHaveLength(1);
    const rs = env.resourceSpans[0];
    expect(rs.resource.attributes).toContainEqual({
      key: "service.name",
      value: { stringValue: "nemocognition" },
    });
    expect(rs.scopeSpans).toHaveLength(1);
    expect(rs.scopeSpans[0].scope.name).toBe("@nemocognition/tracing");
  });

  it("generates hex traceId (32 chars) and spanId (16 chars)", () => {
    const env = buildOtlpEnvelope([makeEvent()], { serviceName: "nemocognition" });
    const span = env.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("uses the same traceId for all spans in a run", () => {
    const env = buildOtlpEnvelope(
      [
        makeEvent({ nodeId: "n1", type: "run_start" }),
        makeEvent({ nodeId: "n2", type: "model_call_start", parentNodeId: "n1" }),
      ],
      { serviceName: "nemocognition" },
    );
    const spans = env.resourceSpans[0].scopeSpans[0].spans;
    expect(spans[0].traceId).toBe(spans[1].traceId);
  });

  it("links parentSpanId to the parent node's spanId", () => {
    const env = buildOtlpEnvelope(
      [
        makeEvent({ nodeId: "n1", type: "run_start" }),
        makeEvent({ nodeId: "n2", type: "model_call_start", parentNodeId: "n1" }),
      ],
      { serviceName: "nemocognition" },
    );
    const spans = env.resourceSpans[0].scopeSpans[0].spans;
    expect(spans[1].parentSpanId).toBe(spans[0].spanId);
  });

  it("uses OpenInference span.kind for model calls", () => {
    const env = buildOtlpEnvelope(
      [makeEvent({ type: "model_call_start" })],
      { serviceName: "nemocognition" },
    );
    const attrs = env.resourceSpans[0].scopeSpans[0].spans[0].attributes;
    expect(attrs).toContainEqual({
      key: "openinference.span.kind",
      value: { stringValue: "LLM" },
    });
  });

  it("includes llm.model_name and llm.provider for model calls", () => {
    const env = buildOtlpEnvelope(
      [makeEvent({ type: "model_call_start" })],
      { serviceName: "nemocognition" },
    );
    const attrs = env.resourceSpans[0].scopeSpans[0].spans[0].attributes;
    const keys = attrs.map((a) => a.key);
    expect(keys).toContain("llm.model_name");
    expect(keys).toContain("llm.provider");
  });

  it("emits TOOL kind for tool calls with tool.name attribute", () => {
    const env = buildOtlpEnvelope(
      [makeEvent({ type: "tool_call_start", attributes: { toolName: "read_file" } })],
      { serviceName: "nemocognition" },
    );
    const attrs = env.resourceSpans[0].scopeSpans[0].spans[0].attributes;
    expect(attrs).toContainEqual({
      key: "openinference.span.kind",
      value: { stringValue: "TOOL" },
    });
    expect(attrs).toContainEqual({
      key: "tool.name",
      value: { stringValue: "read_file" },
    });
  });

  it("emits typed startTimeUnixNano (string of nanoseconds)", () => {
    const env = buildOtlpEnvelope([makeEvent()], { serviceName: "nemocognition" });
    const span = env.resourceSpans[0].scopeSpans[0].spans[0];
    expect(typeof span.startTimeUnixNano).toBe("string");
    expect(span.startTimeUnixNano).toMatch(/^\d+$/);
  });

  it("emits llm.input_messages.* for model_call_start with full chat messages", () => {
    const env = buildOtlpEnvelope(
      [makeEvent({
        type: "model_call_start",
        attributes: {
          promptRef: "inline:hi",
          messages: [
            { role: "system", content: "You are a research agent." },
            { role: "user", content: "Find papers on scaling laws." },
          ],
        },
      })],
      { serviceName: "nemocognition" },
    );
    const attrs = env.resourceSpans[0].scopeSpans[0].spans[0].attributes;
    const keys = attrs.map((a) => a.key);
    expect(keys).toContain("llm.input_messages.0.message.role");
    expect(keys).toContain("llm.input_messages.0.message.content");
    expect(keys).toContain("llm.input_messages.1.message.role");
    expect(keys).toContain("llm.input_messages.1.message.content");
    expect(attrs).toContainEqual({
      key: "llm.input_messages.0.message.role",
      value: { stringValue: "system" },
    });
    expect(attrs).toContainEqual({
      key: "llm.input_messages.1.message.content",
      value: { stringValue: "Find papers on scaling laws." },
    });
    // input.value carries the full transcript as JSON.
    const inputValue = attrs.find((a) => a.key === "input.value");
    expect(inputValue?.value.stringValue).toContain("scaling laws");
  });

  it("emits llm.output_messages.0 for model_call_end with outputMessage", () => {
    const env = buildOtlpEnvelope(
      [makeEvent({
        type: "model_call_end",
        attributes: {
          outputRef: "inline:ok",
          outputMessage: { role: "assistant", content: "Here are the papers..." },
          tokenCount: { input: 10, output: 50 },
          latencyMs: 250,
        },
      })],
      { serviceName: "nemocognition" },
    );
    const attrs = env.resourceSpans[0].scopeSpans[0].spans[0].attributes;
    expect(attrs).toContainEqual({
      key: "llm.output_messages.0.message.role",
      value: { stringValue: "assistant" },
    });
    expect(attrs).toContainEqual({
      key: "llm.output_messages.0.message.content",
      value: { stringValue: "Here are the papers..." },
    });
  });

  it("falls back to inline ref when full messages aren't provided", () => {
    const env = buildOtlpEnvelope(
      [makeEvent({
        type: "model_call_start",
        attributes: { promptRef: "inline:fallback" },
      })],
      { serviceName: "nemocognition" },
    );
    const attrs = env.resourceSpans[0].scopeSpans[0].spans[0].attributes;
    expect(attrs).toContainEqual({
      key: "input.value",
      value: { stringValue: "inline:fallback" },
    });
    expect(attrs.find((a) => a.key === "llm.input_messages.0.message.role")).toBeUndefined();
  });

  it("preserves run/branch/node IDs as attributes", () => {
    const env = buildOtlpEnvelope([makeEvent()], { serviceName: "nemocognition" });
    const attrs = env.resourceSpans[0].scopeSpans[0].spans[0].attributes;
    expect(attrs).toContainEqual({ key: "nemocognition.run_id", value: { stringValue: "run_abc" } });
    expect(attrs).toContainEqual({ key: "nemocognition.branch_id", value: { stringValue: "branch_abc" } });
    expect(attrs).toContainEqual({ key: "nemocognition.node_id", value: { stringValue: "node_1" } });
  });
});

describe("PhoenixExporter", () => {
  // Real HTTP server that captures the protobuf POST and asserts shape.
  let server: Server;
  let port: number;
  let received: Array<{
    method: string;
    url: string;
    contentType: string | undefined;
    bodyLength: number;
  }>;

  beforeAll(async () => {
    received = [];
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received.push({
          method: req.method ?? "",
          url: req.url ?? "",
          contentType: req.headers["content-type"],
          bodyLength: Buffer.concat(chunks).length,
        });
        res.statusCode = 200;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => {
    received.length = 0;
  });

  it("POSTs OTLP protobuf to /v1/traces", async () => {
    const exporter = new PhoenixExporter({
      endpoint: `http://127.0.0.1:${port}`,
      serviceName: "nemocognition",
    });
    await exporter.export([makeEvent()]);
    expect(received.length).toBeGreaterThan(0);
    const last = received[received.length - 1];
    expect(last.method).toBe("POST");
    expect(last.url).toBe("/v1/traces");
    expect(last.contentType).toBe("application/x-protobuf");
    expect(last.bodyLength).toBeGreaterThan(0);
  });

  it("does nothing when given an empty event list", async () => {
    const exporter = new PhoenixExporter({
      endpoint: `http://127.0.0.1:${port}`,
      serviceName: "nemocognition",
    });
    await exporter.export([]);
    expect(received).toHaveLength(0);
  });

  it("trims trailing slash from endpoint", async () => {
    const exporter = new PhoenixExporter({
      endpoint: `http://127.0.0.1:${port}/`,
      serviceName: "nemocognition",
    });
    await exporter.export([makeEvent()]);
    expect(received[received.length - 1].url).toBe("/v1/traces");
  });
});
