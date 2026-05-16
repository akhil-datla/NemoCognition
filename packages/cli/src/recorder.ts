import { RuntimeTracker, type TrackerEvent } from "@nemocognition/nemoclaw";
import type {
  ToolDefinition,
  ToolExecutionResult,
  NimMessage,
  NimToolDef,
} from "@nemocognition/nemoclaw";
import { ToolWrapper, NimClient } from "@nemocognition/nemoclaw";
import { PhoenixExporter } from "@nemocognition/tracing";

export interface RecorderConfig {
  nimEndpoint: string;
  nimApiKey: string;
  nimModel: string;
  phoenixEndpoint: string;
  /** If set, the session will POST recorded events to this NemoCognition API base URL (e.g. http://localhost:3000) */
  nemocognitionApiUrl?: string;
  /** Server-side hook: fires for every TrackerEvent as it happens. Used by the live-stream session runner. */
  onTrackerEvent?: (e: TrackerEvent) => void;
  onSpanExport?: (spans: unknown[]) => void;
  /** Override the NIM chat function (used in tests). When unset, a real NimClient is created. */
  nimChat?: (messages: unknown[], options?: unknown) => Promise<{
    content: string | null;
    toolCalls?: { id: string; name: string; arguments: string }[];
    tokenCount: { input: number; output: number };
    finishReason: string;
  }>;
  /** Custom fetch (used in tests). */
  fetch?: typeof globalThis.fetch;
  /** Service name reported in OTLP spans. */
  serviceName?: string;
}

interface StartInput {
  title: string;
  userTask: string;
}

interface PolicyInput {
  actionType: string;
  decision: "allow" | "deny";
  resource: string;
  normalizedResource: string;
  policyRuleId: string;
  policyRuleText: string;
  policyPath: string;
  reason: string;
  actor: string;
}

interface CheckpointInput {
  memory: Record<string, unknown>;
  policyYaml: string;
}

export class SessionRecorder {
  private config: RecorderConfig;

  constructor(config: RecorderConfig) {
    this.config = config;
  }

  start(input: StartInput): Session {
    return new Session(this.config, input);
  }
}

export class Session {
  private tracker: RuntimeTracker;
  private toolWrapper: ToolWrapper;
  private config: RecorderConfig;
  private events: TrackerEvent[] = [];
  readonly runId: string;
  readonly branchId: string;

  constructor(config: RecorderConfig, input: StartInput) {
    this.config = config;
    this.tracker = new RuntimeTracker({
      onEvent: (e) => {
        this.events.push(e);
        config.onTrackerEvent?.(e);
      },
      phoenixEndpoint: config.phoenixEndpoint,
    });
    this.toolWrapper = new ToolWrapper();

    const { runId, branchId } = this.tracker.startRun(input);
    this.runId = runId;
    this.branchId = branchId;
  }

  private getChatFn(): NonNullable<RecorderConfig["nimChat"]> {
    if (this.config.nimChat) return this.config.nimChat;
    const client = new NimClient({
      endpoint: this.config.nimEndpoint,
      apiKey: this.config.nimApiKey,
      model: this.config.nimModel,
      fetch: this.config.fetch,
    });
    return (messages, options) =>
      client.chat(
        messages as Parameters<NimClient["chat"]>[0],
        options as Parameters<NimClient["chat"]>[1],
      );
  }

  async chat(message: string): Promise<{
    content: string | null;
    tokenCount: { input: number; output: number };
    toolCalls?: { id: string; name: string; arguments: string }[];
  }> {
    return this.chatMessages([{ role: "user", content: message }]);
  }

  async chatMessages(
    messages: NimMessage[],
    options?: { tools?: NimToolDef[] },
  ): Promise<{
    content: string | null;
    tokenCount: { input: number; output: number };
    toolCalls?: { id: string; name: string; arguments: string }[];
  }> {
    const last = messages[messages.length - 1];
    const callId = this.tracker.beforeModelCall({
      promptRef: typeof last?.content === "string" ? last.content : "",
      contextRef: "context:current",
      messages: messages.map((m) => ({ role: m.role, content: m.content ?? "" })),
    });

    const chatFn = this.getChatFn();
    const start = performance.now();
    const response = await chatFn(messages, {
      tools: options?.tools ?? this.toolWrapper.getToolDefinitions(),
    });
    const latencyMs = Math.round(performance.now() - start);

    const outputContent = response.content ?? "";
    this.tracker.afterModelCall(callId, {
      outputRef: outputContent,
      outputMessage: { role: "assistant", content: outputContent },
      tokenCount: response.tokenCount,
      latencyMs,
      toolCallsValid: true,
    });

    return {
      content: response.content,
      tokenCount: response.tokenCount,
      toolCalls: response.toolCalls,
    };
  }

  registerTool(tool: ToolDefinition): void {
    this.toolWrapper.register(tool);
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const callId = this.tracker.beforeToolCall({
      toolName: name,
      inputJson: JSON.stringify(args),
    });

    const result = await this.toolWrapper.execute(name, args);

    this.tracker.afterToolCall(callId, {
      outputRef: result.output ? JSON.stringify(result.output) : null,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      errorClass: result.errorClass,
      filesTouched: result.filesTouched,
    });

    return result;
  }

  recordPolicy(input: PolicyInput): void {
    this.tracker.recordPolicyDecision(input);
  }

  checkpoint(input: CheckpointInput): string {
    return this.tracker.createCheckpoint(input);
  }

  captureMemory(key: string, value: string): void {
    this.tracker.captureMemory({ key, value });
  }

  captureDiff(path: string, diff: string): void {
    this.tracker.captureDiff(path, diff);
  }

  end(status: string): void {
    this.tracker.endRun(status);
  }

  exportSpans(): ReturnType<RuntimeTracker["getSpans"]> {
    return this.tracker.getSpans();
  }

  getEvents(): TrackerEvent[] {
    return [...this.events];
  }

  flush(): void {
    const spans = this.tracker.getSpans();
    this.config.onSpanExport?.(spans);
  }

  /**
   * Export the recorded session to Phoenix via OTLP/HTTP and to the NemoCognition API via REST.
   * Both are best-effort — failures are returned per channel, not thrown.
   */
  async flushToBackends(): Promise<{
    phoenix: { ok: boolean; error?: string };
    api: { ok: boolean; error?: string; skipped?: boolean };
  }> {
    const events = this.getEvents();
    const result = {
      phoenix: { ok: false } as { ok: boolean; error?: string },
      api: { ok: false } as { ok: boolean; error?: string; skipped?: boolean },
    };

    try {
      const exporter = new PhoenixExporter({
        endpoint: this.config.phoenixEndpoint,
        serviceName: this.config.serviceName ?? "nemocognition-cli",
        fetch: this.config.fetch,
      });
      await exporter.export(events);
      result.phoenix.ok = true;
    } catch (err) {
      result.phoenix.error = err instanceof Error ? err.message : String(err);
    }

    if (!this.config.nemocognitionApiUrl) {
      result.api.ok = true;
      result.api.skipped = true;
    } else {
      const fetchFn = this.config.fetch ?? globalThis.fetch;
      const url = `${this.config.nemocognitionApiUrl.replace(/\/+$/, "")}/api/runs/import`;
      const payload = JSON.stringify({ events });
      // 3 attempts at 1s / 2s / 4s. The import handler is idempotent —
      // Postgres `setRun`/`setBranch`/`setNode` all upsert and policy
      // decisions / checkpoints use `onConflictDoNothing`.
      const delays = [0, 1000, 2000];
      let lastError: string | undefined;
      for (let attempt = 0; attempt < delays.length; attempt++) {
        if (delays[attempt] > 0) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
        }
        try {
          const response = await fetchFn(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
          });
          if (!response.ok) {
            const body = await response.text().catch(() => "");
            lastError = `API import failed: ${response.status} ${body}`;
            // 4xx is permanent — don't retry. 5xx + network errors retry.
            if (response.status >= 400 && response.status < 500) break;
            continue;
          }
          result.api.ok = true;
          lastError = undefined;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
      if (lastError) result.api.error = lastError;
    }

    return result;
  }
}
