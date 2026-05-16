import path from "node:path";
import { randomUUID } from "node:crypto";
import { SessionRecorder } from "@nemocognition/cli";
import type { Session } from "@nemocognition/cli";
import type { TrackerEvent, NimMessage, NimToolDef, PolicyConfig } from "@nemocognition/nemoclaw";
import { evaluatePolicy, DEFAULT_POLICY } from "@nemocognition/nemoclaw";
import type { Store } from "@nemocognition/db";
import { ingestTrackerEvents } from "@nemocognition/tracing";
import { buildAgentTools, type AgentTool } from "./agent-tools";
import { takeSnapshot, defaultSnapshotsDir } from "./snapshot";

/** Live status of a running session. Used by the SSE handler. */
export type RunnerStatus = "running" | "completed" | "failed";

export type RunnerControlEvent =
  | { type: "complete"; status: RunnerStatus }
  | { type: "error"; message: string };

export interface RunnerEvent {
  /** Sequence number, monotonically increasing per runner. */
  seq: number;
  /** Tracker event payload OR a control event. */
  event: TrackerEvent | RunnerControlEvent;
}

type Subscriber = (e: RunnerEvent) => void;

export interface SessionRunnerConfig {
  store: Store;
  nimEndpoint: string;
  nimApiKey: string;
  nimModel: string;
  phoenixEndpoint: string;
  /** Filesystem root the agent's tools are sandboxed to. Defaults to process.cwd(). */
  sandboxRoot?: string;
  /** Policy config the runner uses to gate tool calls. Defaults to DEFAULT_POLICY. */
  policy?: PolicyConfig;
  /** Max agent-loop iterations before the loop exits regardless of tool calls. */
  maxIterations?: number;
  /** Directory where per-checkpoint tarball snapshots are written. Defaults to NEMOCLAW_SNAPSHOTS_DIR / tmp. */
  snapshotsDir?: string;
  /** Disable snapshotting (e.g. in unit tests where tar/IO is undesirable). */
  disableSnapshots?: boolean;
  /** Resume an existing run on a new branch (recovery flow). When set, the
   *  runner emits a branch_start instead of run_start. */
  resumeBranch?: {
    runId: string;
    parentBranchId: string;
    parentNodeId: string;
  };
  /** Override NIM chat for tests. */
  nimChat?: ConstructorParameters<typeof SessionRecorder>[0]["nimChat"];
  /** Override fetch for tests (used by Phoenix exporter + API import). */
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_MAX_ITERATIONS = 15;
const SYSTEM_PROMPT = [
  "You are an autonomous coding agent operating inside a real repository.",
  "You have these tools: read_file, list_directory, write_file, run_bash.",
  "Inspect the codebase before changing anything. Verify your edits by re-reading or running commands.",
  "Be concise. When the user's task is done, reply with a short summary and stop calling tools.",
].join(" ");

export class SessionRunner {
  private buffer: RunnerEvent[] = [];
  private subscribers = new Set<Subscriber>();
  private status: RunnerStatus = "running";
  readonly runId: string;
  readonly branchId: string;
  private session: Session;
  private endedAt: number | null = null;

  constructor(private config: SessionRunnerConfig, title: string, userTask: string) {
    const recorder = new SessionRecorder({
      nimEndpoint: config.nimEndpoint,
      nimApiKey: config.nimApiKey,
      nimModel: config.nimModel,
      phoenixEndpoint: config.phoenixEndpoint,
      nimChat: config.nimChat,
      fetch: config.fetch,
      onTrackerEvent: (e) => this.emit(e),
    });
    this.session = config.resumeBranch
      ? recorder.startBranch({
          ...config.resumeBranch,
          title,
          userTask,
        })
      : recorder.start({ title, userTask });
    this.runId = this.session.runId;
    this.branchId = this.session.branchId;
  }

  getRunId(): string {
    return this.runId;
  }

  getStatus(): RunnerStatus {
    return this.status;
  }

  getEndedAt(): number | null {
    return this.endedAt;
  }

  /** Subscribe to live events. New subscribers receive the buffered backlog first. */
  subscribe(cb: Subscriber): () => void {
    for (const e of this.buffer) cb(e);
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private emit(event: TrackerEvent | RunnerControlEvent): void {
    const wrapped: RunnerEvent = { seq: this.buffer.length, event };
    this.buffer.push(wrapped);
    for (const cb of this.subscribers) {
      try {
        cb(wrapped);
      } catch {
        /* ignore failed subscribers */
      }
    }
  }

  async run(userTask: string): Promise<void> {
    const sandboxRoot = this.config.sandboxRoot ?? process.cwd();
    const policy = this.config.policy ?? DEFAULT_POLICY;
    const maxIterations = this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const tools = buildAgentTools(sandboxRoot);
    const toolByName = new Map<string, AgentTool>(tools.map((t) => [t.name, t]));

    for (const t of tools) {
      this.session.registerTool({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        execute: t.execute,
      });
    }

    const toolDefs: NimToolDef[] = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    const messages: NimMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userTask },
    ];

    let finalStatus: RunnerStatus = "completed";
    try {
      for (let iter = 0; iter < maxIterations; iter++) {
        const resp = await this.session.chatMessages(messages, { tools: toolDefs });

        const assistantMsg: NimMessage = {
          role: "assistant",
          content: resp.content,
        };
        if (resp.toolCalls?.length) {
          assistantMsg.tool_calls = resp.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
          }));
        }
        messages.push(assistantMsg);

        if (!resp.toolCalls?.length) break;

        for (const tc of resp.toolCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = tc.arguments ? JSON.parse(tc.arguments) : {};
          } catch {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: `Tool argument parse error: arguments were not valid JSON: ${tc.arguments}`,
            });
            continue;
          }

          const tool = toolByName.get(tc.name);
          if (!tool) {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: `Unknown tool: ${tc.name}`,
            });
            continue;
          }

          const resource = tool.resourceFromArgs(args);
          const decision = evaluatePolicy(tool.actionType, resource, policy);
          this.session.recordPolicy({
            actionType: tool.actionType,
            decision: decision.decision,
            resource,
            normalizedResource: decision.normalizedResource,
            policyRuleId: decision.ruleId,
            policyRuleText: decision.ruleText,
            policyPath: decision.policyPath,
            reason: decision.reason,
            actor: "nemoclaw_agent",
          });

          if (decision.decision === "deny") {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: `Tool call denied by policy rule ${decision.ruleId}: ${decision.reason}`,
            });
            continue;
          }

          let snapshotPath: string | null = null;
          if (!this.config.disableSnapshots) {
            const snapshotsDir = this.config.snapshotsDir ?? defaultSnapshotsDir();
            const tarPath = path.join(snapshotsDir, this.runId, `${randomUUID()}.tar.gz`);
            try {
              const r = await takeSnapshot(sandboxRoot, tarPath);
              snapshotPath = r.tarPath;
            } catch (snapErr) {
              this.emit({
                type: "error",
                message: `Snapshot failed: ${snapErr instanceof Error ? snapErr.message : String(snapErr)}`,
              });
            }
          }

          this.session.checkpoint({
            memory: {
              iteration: iter,
              nextTool: tc.name,
              nextArgs: args,
              messages: JSON.parse(JSON.stringify(messages)) as NimMessage[],
              __snapshotPath: snapshotPath,
            },
            policyYaml: "",
          });

          const result = await this.session.executeTool(tc.name, args);
          const payload = result.errorClass
            ? { error: result.errorClass, output: result.output }
            : { output: result.output };
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(payload),
          });
        }
      }
    } catch (err) {
      this.emit({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      finalStatus = "failed";
    }
    try {
      this.session.end(finalStatus);
    } catch {
      /* already ended */
    }
    this.status = finalStatus;

    // Persist + Phoenix export — best effort, don't throw.
    try {
      const events = this.session.getEvents();
      const ingest = ingestTrackerEvents(events);
      // Branch resume runs have no run_start event so ingest.run is null —
      // always persist branches/nodes/etc; only upsert the Run when present.
      if (ingest.run) {
        ingest.run.sandboxRoot = sandboxRoot;
        await this.config.store.setRun(ingest.run);
      }
      for (const b of ingest.branches) await this.config.store.setBranch(b);
      for (const n of ingest.nodes) await this.config.store.setNode(n);
      for (const c of ingest.checkpoints) await this.config.store.setCheckpoint(c);
      for (const p of ingest.policyDecisions) await this.config.store.setPolicyDecision(p);
      await this.session.flushToBackends();
    } catch (err) {
      this.emit({
        type: "error",
        message: `Persistence failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    this.endedAt = Date.now();
    this.emit({ type: "complete", status: this.status });
  }
}
