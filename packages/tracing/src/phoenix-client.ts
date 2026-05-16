import { randomBytes } from "node:crypto";
import { trace, SpanStatusCode, type SpanContext, type AttributeValue } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  Span as SdkSpan,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import type { TrackerEvent } from "@nemocognition/nemoclaw";
import { OI_KIND, OI_SPAN_KIND, ATTR, eventTypeToOIKind, messageAttr } from "./openinference";

interface ChatMessage {
  role: string;
  content: string;
}

// --- Public OTLP envelope type, kept for tests that assert on the shape ---
interface OtlpAttrValue {
  stringValue?: string;
  intValue?: string;
  boolValue?: boolean;
  doubleValue?: number;
}
interface OtlpAttr {
  key: string;
  value: OtlpAttrValue;
}
interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttr[];
  status: { code: number };
}
export interface OtlpEnvelope {
  resourceSpans: Array<{
    resource: { attributes: OtlpAttr[] };
    scopeSpans: Array<{
      scope: { name: string; version: string };
      spans: OtlpSpan[];
    }>;
  }>;
}

interface BuildOptions {
  serviceName: string;
}

function hexId(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function attr(key: string, value: unknown): OtlpAttr | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return { key, value: { stringValue: value } };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { key, value: { intValue: String(value) } }
      : { key, value: { doubleValue: value } };
  }
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  return { key, value: { stringValue: JSON.stringify(value) } };
}

function attrs(pairs: Array<[string, unknown]>): OtlpAttr[] {
  const out: OtlpAttr[] = [];
  for (const [k, v] of pairs) {
    const a = attr(k, v);
    if (a) out.push(a);
  }
  return out;
}

function isoToNanos(iso: string): string {
  return String(BigInt(new Date(iso).getTime()) * 1_000_000n);
}

function eventAttributePairs(event: TrackerEvent): Array<[string, unknown]> {
  const kind = eventTypeToOIKind(event.type);
  const base: Array<[string, unknown]> = [
    [OI_SPAN_KIND, OI_KIND[kind]],
    [ATTR.nemoRunId, event.runId],
    [ATTR.nemoBranchId, event.branchId],
    [ATTR.nemoNodeId, event.nodeId],
    [ATTR.nemoParentNodeId, event.parentNodeId ?? undefined],
    [ATTR.nemoEventType, event.type],
  ];

  if (kind === "LLM") {
    base.push([ATTR.llmModelName, "nemotron"]);
    base.push([ATTR.llmProvider, "nvidia"]);
    const tc = event.attributes.tokenCount as { input?: number; output?: number } | undefined;
    if (tc) {
      base.push([ATTR.llmTokenCountPrompt, tc.input]);
      base.push([ATTR.llmTokenCountCompletion, tc.output]);
    }
    const latency = event.attributes.latencyMs;
    if (typeof latency === "number") base.push([ATTR.llmLatencyMs, latency]);

    // Phoenix's LLM panel needs OpenInference-conventional message attributes
    // to render the chat transcript. When the recorder passed the full
    // messages we surface them here; otherwise we fall back to inline refs.
    const messages = event.attributes.messages as ChatMessage[] | undefined;
    if (messages?.length) {
      base.push([ATTR.inputMimeType, "application/json"]);
      base.push([ATTR.inputValue, JSON.stringify(messages)]);
      messages.forEach((m, i) => {
        base.push([messageAttr("input", i, "role"), m.role]);
        base.push([messageAttr("input", i, "content"), m.content]);
      });
    } else if (event.attributes.promptRef) {
      base.push([ATTR.inputValue, event.attributes.promptRef]);
    }

    const outputMessage = event.attributes.outputMessage as ChatMessage | undefined;
    if (outputMessage) {
      base.push([ATTR.outputMimeType, "application/json"]);
      base.push([ATTR.outputValue, JSON.stringify(outputMessage)]);
      base.push([messageAttr("output", 0, "role"), outputMessage.role]);
      base.push([messageAttr("output", 0, "content"), outputMessage.content]);
    } else if (event.attributes.outputRef) {
      base.push([ATTR.outputValue, event.attributes.outputRef as string]);
    }
  }

  if (kind === "TOOL") {
    const toolName = event.attributes.toolName;
    if (toolName) base.push([ATTR.toolName, toolName]);
    const inputJson = event.attributes.inputJson;
    if (inputJson) base.push([ATTR.toolParameters, inputJson]);
    const exitCode = event.attributes.exitCode;
    if (typeof exitCode === "number") base.push([ATTR.toolExitCode, exitCode]);
    const durationMs = event.attributes.durationMs;
    if (typeof durationMs === "number") base.push([ATTR.toolDurationMs, durationMs]);
    const errorClass = event.attributes.errorClass;
    if (errorClass) base.push([ATTR.toolErrorClass, errorClass]);
  }

  if (event.type === "policy_allow" || event.type === "policy_deny") {
    base.push([ATTR.policyDecision, event.attributes.decision]);
    base.push([ATTR.policyActionType, event.attributes.actionType]);
    base.push([ATTR.policyResource, event.attributes.resource]);
    base.push([ATTR.policyRuleId, event.attributes.policyRuleId]);
    base.push([ATTR.policyReason, event.attributes.reason]);
  }

  return base;
}

/**
 * Build an OTLP/JSON envelope from tracker events. Used by tests that assert
 * on the wire format. The actual exporter ships protobuf via the OTel SDK.
 */
export function buildOtlpEnvelope(events: TrackerEvent[], options: BuildOptions): OtlpEnvelope {
  if (events.length === 0) {
    return {
      resourceSpans: [{
        resource: { attributes: attrs([["service.name", options.serviceName]]) },
        scopeSpans: [{
          scope: { name: "@nemocognition/tracing", version: "0.1.0" },
          spans: [],
        }],
      }],
    };
  }

  const runToTraceId = new Map<string, string>();
  const nodeToSpanId = new Map<string, string>();

  for (const event of events) {
    if (!runToTraceId.has(event.runId)) runToTraceId.set(event.runId, hexId(16));
    if (!nodeToSpanId.has(event.nodeId)) nodeToSpanId.set(event.nodeId, hexId(8));
  }

  const spans: OtlpSpan[] = events.map((event) => {
    const ts = isoToNanos(event.timestamp);
    const span: OtlpSpan = {
      traceId: runToTraceId.get(event.runId)!,
      spanId: nodeToSpanId.get(event.nodeId)!,
      name: event.type,
      kind: 1,
      startTimeUnixNano: ts,
      endTimeUnixNano: ts,
      attributes: attrs(eventAttributePairs(event)),
      status: {
        code:
          event.type === "policy_deny" || (event.type === "run_end" && event.attributes.status === "failed")
            ? 2
            : 1,
      },
    };
    if (event.parentNodeId && nodeToSpanId.has(event.parentNodeId)) {
      span.parentSpanId = nodeToSpanId.get(event.parentNodeId)!;
    }
    return span;
  });

  return {
    resourceSpans: [{
      resource: { attributes: attrs([["service.name", options.serviceName]]) },
      scopeSpans: [{
        scope: { name: "@nemocognition/tracing", version: "0.1.0" },
        spans,
      }],
    }],
  };
}

// --- Exporter (real OTLP/protobuf over HTTP via OTel SDK) ---

export interface PhoenixExporterConfig {
  endpoint: string;
  serviceName: string;
  /** Optional fetch (no longer used by the protobuf exporter — kept for back-compat). */
  fetch?: typeof globalThis.fetch;
}

/**
 * Ships tracker events to Arize Phoenix via OTLP/HTTP+protobuf using the
 * official OpenTelemetry SDK. Phoenix's HTTP collector at /v1/traces accepts
 * `application/x-protobuf` only (JSON returns 415).
 */
export class PhoenixExporter {
  private endpoint: string;
  private serviceName: string;

  constructor(config: PhoenixExporterConfig) {
    this.endpoint = config.endpoint.replace(/\/+$/, "");
    this.serviceName = config.serviceName;
  }

  async export(events: TrackerEvent[]): Promise<void> {
    if (events.length === 0) return;

    const url = `${this.endpoint}/v1/traces`;
    const exporter = new OTLPTraceExporter({ url });
    const provider = new BasicTracerProvider({
      resource: resourceFromAttributes({ "service.name": this.serviceName }),
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const tracer = provider.getTracer("@nemocognition/tracing", "0.1.0");

    // Build deterministic IDs first so parent links work across spans.
    const runToTraceId = new Map<string, string>();
    const nodeToSpanId = new Map<string, string>();
    for (const event of events) {
      if (!runToTraceId.has(event.runId)) runToTraceId.set(event.runId, hexId(16));
      if (!nodeToSpanId.has(event.nodeId)) nodeToSpanId.set(event.nodeId, hexId(8));
    }

    for (const event of events) {
      const traceId = runToTraceId.get(event.runId)!;
      const spanId = nodeToSpanId.get(event.nodeId)!;
      const ctx: SpanContext = { traceId, spanId, traceFlags: 1, isRemote: false };

      // Construct an SDK Span manually so we control trace/span IDs and timestamps.
      const startTimeMs = new Date(event.timestamp).getTime();
      // SdkSpan constructor signature (positional, internal API). The
      // BasicTracerProvider returns Tracer impl that creates spans; we use it
      // here purely to get a working SpanProcessor pipeline.
      const span = tracer.startSpan(event.type, {
        startTime: startTimeMs,
        attributes: toOtelAttributes(eventAttributePairs(event)),
      }) as unknown as SdkSpan;

      // Override the generated SpanContext with our deterministic IDs by
      // mutating the internal state. This is the price of pre-assigning IDs;
      // the OTel SDK doesn't expose a public API for it.
      // @ts-expect-error: SdkSpan internal field
      span._spanContext = ctx;
      if (event.parentNodeId && nodeToSpanId.has(event.parentNodeId)) {
        // @ts-expect-error: SdkSpan internal field
        span.parentSpanContext = {
          traceId,
          spanId: nodeToSpanId.get(event.parentNodeId)!,
          traceFlags: 1,
          isRemote: false,
        };
      }

      const failed =
        event.type === "policy_deny" || (event.type === "run_end" && event.attributes.status === "failed");
      span.setStatus({ code: failed ? SpanStatusCode.ERROR : SpanStatusCode.OK });
      span.end(startTimeMs);
    }

    await provider.forceFlush();
    await provider.shutdown();
    // Silence unused-import lint warnings; trace is exported for callers.
    void trace;
  }
}

function toOtelAttributes(pairs: Array<[string, unknown]>): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {};
  for (const [k, v] of pairs) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else {
      out[k] = JSON.stringify(v);
    }
  }
  return out;
}
