import { promises as fs } from "node:fs";
import { SessionRecorder } from "@nemocognition/cli";
import type { Session, BranchFromInput } from "@nemocognition/cli";
import type { TrackerEvent, PolicyConfig } from "@nemocognition/nemoclaw";
import { AgentLoop } from "@nemocognition/nemoclaw";
import type { Store } from "@nemocognition/db";
import { ingestTrackerEvents } from "@nemocognition/tracing";
import { buildAgentTools } from "./agent-tools";
import { snapper, sandboxRootForRun } from "./snapper";

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
  /** Override NIM chat for tests. */
  nimChat?: ConstructorParameters<typeof SessionRecorder>[0]["nimChat"];
  /** Override fetch for tests (used by Phoenix exporter + API import). */
  fetch?: typeof globalThis.fetch;
  /**
   * Maximum number of autonomous policy-violation recoveries before the runner
   * stops forking new branches and falls back to feeding the deny message back
   * to the model. Defaults to 3.
   */
  maxAutoRecoveries?: number;
}

/**
 * `SessionRunner` is the consumer-side wrapper around Nemoclaw's `AgentLoop`.
 * It owns:
 *   - SSE-style subscriber/buffer plumbing for the live replay UI
 *   - the concrete filesystem `Snapper` (which satisfies Nemoclaw's
 *     `Snapshotter` interface)
 *   - eager branch persistence into the store on autonomous fork
 *   - Phoenix OTLP + replay-API flush at the end of the run
 *
 * All loop logic, policy gating, snapshotting decisions, and autonomous
 * rollback live in `@nemocognition/nemoclaw`'s `AgentLoop`.
 */
export class SessionRunner {
  private buffer: RunnerEvent[] = [];
  private subscribers = new Set<Subscriber>();
  private status: RunnerStatus = "running";
  readonly runId: string;
  readonly branchId: string;
  /** "start" for fresh runs; "branch" for recovery branches resuming an existing run. */
  readonly mode: "start" | "branch";
  private session: Session;
  private endedAt: number | null = null;

  constructor(
    private config: SessionRunnerConfig,
    title: string,
    userTask: string,
    branchFrom?: BranchFromInput,
  ) {
    const recorder = new SessionRecorder({
      nimEndpoint: config.nimEndpoint,
      nimApiKey: config.nimApiKey,
      nimModel: config.nimModel,
      phoenixEndpoint: config.phoenixEndpoint,
      nimChat: config.nimChat,
      fetch: config.fetch,
      onTrackerEvent: (e) => this.emit(e),
    });
    this.session = branchFrom
      ? recorder.branch(branchFrom)
      : recorder.start({ title, userTask });
    this.runId = this.session.runId;
    this.branchId = this.session.branchId;
    this.mode = branchFrom ? "branch" : "start";
  }

  /**
   * Create a SessionRunner that resumes an existing run as a recovery branch.
   * The new branch shares the parent runId, persists into the same graph, and
   * its events stream over a freshly registered SSE channel.
   */
  static fromBranch(
    config: SessionRunnerConfig,
    branchInput: BranchFromInput,
  ): SessionRunner {
    return new SessionRunner(config, "__recovery_branch__", "", branchInput);
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
    const sandboxRoot = this.config.sandboxRoot ?? sandboxRootForRun(this.runId);
    await fs.mkdir(sandboxRoot, { recursive: true });

    const tools = buildAgentTools(sandboxRoot);

    const loop = new AgentLoop({
      session: this.session,
      tools,
      sandboxRoot,
      snapshotter: snapper,
      policy: this.config.policy,
      maxIterations: this.config.maxIterations,
      maxAutoRecoveries: this.config.maxAutoRecoveries,
      onError: (message) => this.emit({ type: "error", message }),
      onBranchFork: async ({ failedBranchId, newBranchId, forkNodeId, correctionSummary, runId }) => {
        const failedBranch = await this.config.store.getBranch(failedBranchId);
        if (failedBranch && failedBranch.status !== "failed") {
          await this.config.store.setBranch({ ...failedBranch, status: "failed" });
        }
        await this.config.store.setBranch({
          id: newBranchId,
          runId,
          parentBranchId: failedBranchId,
          forkNodeId,
          status: "running",
          correctionSummary,
          createdAt: new Date().toISOString(),
        });
      },
    });

    const result = await loop.run(userTask);
    this.status = result.status;

    // Persist + Phoenix export — best effort, don't throw.
    try {
      const events = this.session.getEvents();
      const ingest = ingestTrackerEvents(events);
      // Recovery branches don't emit run_start (the parent run already
      // exists), so `ingest.run` is null but the branch + node rows must
      // still be persisted into the same graph.
      if (ingest.run) await this.config.store.setRun(ingest.run);
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
