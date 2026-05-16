import { randomUUID } from "node:crypto";

export interface TrackerEvent {
  type: string;
  runId: string;
  branchId: string;
  nodeId: string;
  parentNodeId: string | null;
  timestamp: string;
  attributes: Record<string, unknown>;
}

interface TrackerConfig {
  onEvent: (event: TrackerEvent) => void;
  phoenixEndpoint: string;
}

interface StartRunInput {
  title: string;
  userTask: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

interface BeforeModelCallInput {
  promptRef: string;
  contextRef: string;
  /** Full chat history sent to the model. When present, surfaced in Phoenix's LLM panel. */
  messages?: ChatMessage[];
}

interface AfterModelCallInput {
  outputRef: string;
  tokenCount: { input: number; output: number };
  latencyMs: number;
  toolCallsValid: boolean;
  /** Full model response. When present, surfaced in Phoenix's LLM panel. */
  outputMessage?: ChatMessage;
}

interface BeforeToolCallInput {
  toolName: string;
  inputJson: string;
}

interface AfterToolCallInput {
  outputRef: string | null;
  exitCode: number;
  durationMs: number;
  errorClass: string | null;
  filesTouched: string[];
}

interface MemoryInput {
  key: string;
  value: string;
}

interface PolicyDecisionInput {
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
  /** Filesystem snapshot artifact path on disk (TAR). Optional; absent for memory-only checkpoints. */
  artifactPath?: string;
  /** sha256 of the snapshot archive. */
  checksum?: string;
  /** Number of files captured in the snapshot. */
  fileCount?: number;
  /** Trigger that produced this checkpoint. */
  kind?: "pre_tool" | "post_tool" | "final" | "manual" | "pre_restore";
}

interface ValidateInput {
  status: "pass" | "fail";
  evidence: string[];
}

interface OpenInferenceSpan {
  runId: string;
  branchId: string;
  nodeId: string;
  parentNodeId: string | null;
  type: string;
  provider: string;
  model: string;
  timestamp: string;
  attributes: Record<string, unknown>;
}

export class RuntimeTracker {
  private config: TrackerConfig;
  private runId: string | null = null;
  private branchId: string | null = null;
  private lastNodeId: string | null = null;
  private events: TrackerEvent[] = [];

  constructor(config: TrackerConfig) {
    this.config = config;
  }

  startRun(input: StartRunInput): { runId: string; branchId: string } {
    this.runId = `run_${randomUUID()}`;
    this.branchId = `branch_${randomUUID()}`;
    const nodeId = this.nextNodeId();

    this.emit({
      type: "run_start",
      nodeId,
      parentNodeId: null,
      attributes: {
        title: input.title,
        userTask: input.userTask,
        provider: "nvidia",
        model: "nemotron",
      },
    });

    return { runId: this.runId, branchId: this.branchId };
  }

  /**
   * Initialise the tracker as a recovery branch of an existing run. Emits a
   * `branch_start` event linking the new branch back to its parent and the
   * fork node. No `run_start` is emitted — the parent run already exists.
   */
  branchOff(input: {
    runId: string;
    parentBranchId: string;
    forkNodeId: string;
    branchId?: string;
    correctionSummary?: string;
    checkpointId?: string;
    failureCategory?: string;
  }): { runId: string; branchId: string } {
    this.runId = input.runId;
    this.branchId = input.branchId ?? `branch_${randomUUID()}`;
    const nodeId = this.nextNodeId();

    this.emit({
      type: "branch_start",
      nodeId,
      parentNodeId: input.forkNodeId,
      attributes: {
        parentBranchId: input.parentBranchId,
        forkNodeId: input.forkNodeId,
        correctionSummary: input.correctionSummary ?? null,
        checkpointId: input.checkpointId ?? null,
        failureCategory: input.failureCategory ?? null,
      },
    });

    return { runId: this.runId, branchId: this.branchId };
  }

  beforeModelCall(input: BeforeModelCallInput): string {
    const callId = `mc_${randomUUID()}`;
    this.emit({
      type: "model_call_start",
      nodeId: callId,
      parentNodeId: this.lastNodeId,
      attributes: {
        promptRef: input.promptRef,
        contextRef: input.contextRef,
        messages: input.messages,
      },
    });
    return callId;
  }

  afterModelCall(callId: string, input: AfterModelCallInput): void {
    this.emit({
      type: "model_call_end",
      nodeId: this.nextNodeId(),
      parentNodeId: callId,
      attributes: {
        callId,
        outputRef: input.outputRef,
        outputMessage: input.outputMessage,
        tokenCount: input.tokenCount,
        latencyMs: input.latencyMs,
        toolCallsValid: input.toolCallsValid,
      },
    });
  }

  beforeToolCall(input: BeforeToolCallInput): string {
    const callId = `tc_${randomUUID()}`;
    this.emit({
      type: "tool_call_start",
      nodeId: callId,
      parentNodeId: this.lastNodeId,
      attributes: {
        toolName: input.toolName,
        inputJson: input.inputJson,
      },
    });
    return callId;
  }

  afterToolCall(callId: string, input: AfterToolCallInput): void {
    this.emit({
      type: "tool_call_end",
      nodeId: this.nextNodeId(),
      parentNodeId: callId,
      attributes: {
        callId,
        outputRef: input.outputRef,
        exitCode: input.exitCode,
        durationMs: input.durationMs,
        errorClass: input.errorClass,
        filesTouched: input.filesTouched,
      },
    });
  }

  captureMemory(input: MemoryInput): void {
    this.emit({
      type: "memory_update",
      nodeId: this.nextNodeId(),
      parentNodeId: this.lastNodeId,
      attributes: { key: input.key, value: input.value },
    });
  }

  captureDiff(path: string, diff: string): void {
    this.emit({
      type: "file_diff",
      nodeId: this.nextNodeId(),
      parentNodeId: this.lastNodeId,
      attributes: { path, diff },
    });
  }

  recordPolicyDecision(input: PolicyDecisionInput): void {
    const type = input.decision === "allow" ? "policy_allow" : "policy_deny";
    this.emit({
      type,
      nodeId: this.nextNodeId(),
      parentNodeId: this.lastNodeId,
      attributes: { ...input },
    });
  }

  createCheckpoint(input: CheckpointInput): string {
    const checkpointId = `cp_${randomUUID()}`;
    this.emit({
      type: "checkpoint",
      nodeId: this.nextNodeId(),
      parentNodeId: this.lastNodeId,
      attributes: {
        checkpointId,
        memory: input.memory,
        policyYaml: input.policyYaml,
        artifactPath: input.artifactPath,
        checksum: input.checksum,
        fileCount: input.fileCount,
        kind: input.kind,
      },
    });
    return checkpointId;
  }

  validate(input: ValidateInput): void {
    this.emit({
      type: "validation",
      nodeId: this.nextNodeId(),
      parentNodeId: this.lastNodeId,
      attributes: { status: input.status, evidence: input.evidence },
    });
  }

  endRun(status: string): void {
    this.emit({
      type: "run_end",
      nodeId: this.nextNodeId(),
      parentNodeId: this.lastNodeId,
      attributes: { status },
    });
  }

  getSpans(): OpenInferenceSpan[] {
    return this.events.map((event) => ({
      runId: event.runId,
      branchId: event.branchId,
      nodeId: event.nodeId,
      parentNodeId: event.parentNodeId,
      type: event.type,
      provider: "nvidia",
      model: "nemotron",
      timestamp: event.timestamp,
      attributes: event.attributes,
    }));
  }

  /** Most recently emitted node id, or null before any emission. */
  getLastNodeId(): string | null {
    return this.lastNodeId;
  }

  /** Current run id; null before startRun/branchOff. */
  getRunId(): string | null {
    return this.runId;
  }

  /** Current branch id; switches after branchOff. */
  getBranchId(): string | null {
    return this.branchId;
  }

  /** All recorded events in emission order. Used by consumers that need to ship the trace to a replay UI without going through the OpenInferenceSpan transform. */
  getEvents(): TrackerEvent[] {
    return [...this.events];
  }

  private nextNodeId(): string {
    return `node_${randomUUID()}`;
  }

  private emit(partial: {
    type: string;
    nodeId: string;
    parentNodeId: string | null;
    attributes: Record<string, unknown>;
  }): void {
    const event: TrackerEvent = {
      type: partial.type,
      runId: this.runId!,
      branchId: this.branchId!,
      nodeId: partial.nodeId,
      parentNodeId: partial.parentNodeId,
      timestamp: new Date().toISOString(),
      attributes: partial.attributes,
    };
    this.events.push(event);
    this.lastNodeId = partial.nodeId;
    this.config.onEvent(event);
  }
}
