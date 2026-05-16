import { randomUUID } from "node:crypto";
import type { ActionType } from "@nemocognition/core";
import { classifyFailure } from "@nemocognition/core";
import {
  RecoveryOrchestrator,
  type CheckpointData as RecoveryCheckpointData,
} from "@nemocognition/recovery";
import {
  evaluatePolicy,
  DEFAULT_POLICY,
  type PolicyConfig,
  type PolicyEvaluation,
} from "./policy-engine";
import type { NimMessage, NimToolDef } from "./nim-client";
import type { ToolDefinition } from "./tool-wrapper";

/**
 * AgentLoop is Nemoclaw's autonomous coding-agent loop.
 *
 * Given a Nemoclaw `Session` (NIM client + tool wrapper + runtime tracker +
 * checkpoint hooks already composed), a tool registry, and a policy config,
 * it drives a chat-and-tool loop with Nemotron, gates every tool call through
 * the policy engine, snapshots the sandbox around mutating actions, and on a
 * `policy_deny` autonomously rolls back the filesystem, forks the session
 * onto a recovery branch, and resumes — until the run is "all green" or the
 * recovery budget is exhausted.
 *
 * It is deliberately decoupled from any specific Session implementation
 * (`SessionLike` interface) and any specific filesystem snapshotter
 * (`Snapshotter` interface) so it can live in `@nemocognition/nemoclaw` and
 * be reused from any consumer (the CLI binary, the web session runner, …).
 */

/** Nemoclaw-aware tool: a ToolDefinition tagged with the action it represents and how to extract the resource string for policy evaluation. */
export interface AgentTool extends ToolDefinition {
  actionType: ActionType;
  resourceFromArgs: (args: Record<string, unknown>) => string;
}

/** Metadata returned by a successful snapshot. */
export interface AgentSnapshotResult {
  cpId: string;
  artifactPath: string;
  manifestPath: string;
  checksum: string;
  fileCount: number;
}

/** Input to {@link Snapshotter.snapshot}. */
export interface AgentSnapshotInput {
  runId: string;
  branchId: string;
  nodeId: string;
  kind: "pre_tool" | "post_tool" | "final" | "manual" | "pre_restore";
  sandboxRoot: string;
}

/** Filesystem snapshotter — abstracted so AgentLoop can live in a fs-agnostic package. */
export interface Snapshotter {
  snapshot(input: AgentSnapshotInput): Promise<AgentSnapshotResult>;
  extract(artifactPath: string, destDir: string): Promise<void>;
}

/** Branch persistence callback — invoked eagerly when the loop forks a recovery branch so the live graph updates before the next model turn. */
export type BranchPersistenceCallback = (input: {
  failedBranchId: string;
  newBranchId: string;
  forkNodeId: string;
  failureCategory: string;
  correctionSummary: string;
  runId: string;
}) => Promise<void>;

/** Non-fatal error sink — used for snapshot failures, persistence retries, etc. */
export type ErrorSink = (message: string) => void;

/**
 * The subset of a Nemoclaw `Session` that AgentLoop actually uses. Anything
 * implementing this shape — including `@nemocognition/cli`'s `Session` — can
 * be driven by the loop.
 */
export interface SessionLike {
  readonly runId: string;
  readonly branchId: string;
  registerTool(tool: ToolDefinition): void;
  chatMessages(
    messages: NimMessage[],
    options?: { tools?: NimToolDef[] },
  ): Promise<{
    content: string | null;
    tokenCount: { input: number; output: number };
    toolCalls?: { id: string; name: string; arguments: string }[];
  }>;
  executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{
    toolName: string;
    output: unknown;
    exitCode: number;
    durationMs: number;
    errorClass: string | null;
    filesTouched: string[];
  }>;
  recordPolicy(input: {
    actionType: string;
    decision: "allow" | "deny";
    resource: string;
    normalizedResource: string;
    policyRuleId: string;
    policyRuleText: string;
    policyPath: string;
    reason: string;
    actor: string;
  }): void;
  checkpoint(input: {
    memory: Record<string, unknown>;
    policyYaml: string;
    artifactPath?: string;
    checksum?: string;
    fileCount?: number;
    kind?: "pre_tool" | "post_tool" | "final" | "manual" | "pre_restore";
  }): string;
  forkInto(input: {
    runId: string;
    parentBranchId: string;
    forkNodeId: string;
    branchId?: string;
    correctionSummary?: string;
    checkpointId?: string;
    failureCategory?: string;
  }): { runId: string; branchId: string };
  getLastNodeId(): string | null;
  end(status: string): void;
}

export interface AgentLoopConfig {
  session: SessionLike;
  tools: AgentTool[];
  sandboxRoot: string;
  snapshotter: Snapshotter;
  policy?: PolicyConfig;
  maxIterations?: number;
  /** Max autonomous policy-violation recoveries before falling back to feeding the deny message back to the model. Defaults to 3. */
  maxAutoRecoveries?: number;
  /** Override the system prompt. Defaults to the Nemoclaw autonomous coding-agent prompt. */
  systemPrompt?: string;
  /** Called when an autonomous fork happens — consumers persist the failed branch + new branch eagerly so the live graph picks up the purple fork arrow before the next turn finishes. */
  onBranchFork?: BranchPersistenceCallback;
  /** Non-fatal error sink. */
  onError?: ErrorSink;
}

export interface AgentLoopResult {
  status: "completed" | "failed";
  autoRecoveriesUsed: number;
  finalBranchId: string;
}

const DEFAULT_MAX_ITERATIONS = 15;
const DEFAULT_MAX_AUTO_RECOVERIES = 3;
const DEFAULT_SYSTEM_PROMPT = [
  "You are an autonomous coding agent operating inside a real repository.",
  "You have these tools: read_file, list_directory, write_file, run_bash.",
  "Inspect the codebase before changing anything. Verify your edits by re-reading or running commands.",
  "Be concise. When the user's task is done, reply with a short summary and stop calling tools.",
].join(" ");

interface FsCheckpoint {
  cpId: string;
  artifactPath: string;
  manifestPath: string;
  nodeId: string;
  branchId: string;
}

export class AgentLoop {
  private readonly recoveryOrchestrator = new RecoveryOrchestrator();
  private autoRecoveriesUsed = 0;
  private currentBranchId: string;
  /** Most-recent FS snapshot — the rollback target for an autonomous recovery. */
  private lastFsCheckpoint: FsCheckpoint | null = null;

  constructor(private config: AgentLoopConfig) {
    this.currentBranchId = config.session.branchId;
    for (const t of config.tools) {
      config.session.registerTool({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        execute: t.execute,
      });
    }
  }

  /** The live branch id — switches after each autonomous fork. */
  getCurrentBranchId(): string {
    return this.currentBranchId;
  }

  /** Number of autonomous recoveries the loop has used so far. */
  getAutoRecoveriesUsed(): number {
    return this.autoRecoveriesUsed;
  }

  async run(userTask: string): Promise<AgentLoopResult> {
    const { session, tools, policy = DEFAULT_POLICY, sandboxRoot } = this.config;
    const maxIterations = this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const maxAutoRecoveries = this.config.maxAutoRecoveries ?? DEFAULT_MAX_AUTO_RECOVERIES;
    const systemPrompt = this.config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

    const toolByName = new Map<string, AgentTool>(tools.map((t) => [t.name, t]));
    const toolDefs: NimToolDef[] = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    const isMutating = (t: AgentTool): boolean =>
      t.actionType === "file_write" || t.actionType === "command_execution";

    let messages: NimMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userTask },
    ];

    // Baseline snapshot — guarantees the FIRST tool call can roll back even
    // if it's a read deny (no pre_tool snapshot has been taken yet).
    await this.snapAndCheckpoint("manual", session.runId);

    let finalStatus: "completed" | "failed" = "completed";
    try {
      outer: for (let iter = 0; iter < maxIterations; iter++) {
        const resp = await session.chatMessages(messages, { tools: toolDefs });

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
          session.recordPolicy({
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
            const denyHandled = await this.handleAutonomousRollback({
              tool,
              decision,
              toolCallId: tc.id,
              userTask,
              maxAutoRecoveries,
            });

            if (denyHandled.recovered) {
              this.autoRecoveriesUsed += 1;
              // Reset context so the recovery branch starts with just
              // system + correction prompt. The failed branch's history
              // is intentionally discarded.
              messages = [
                { role: "system", content: systemPrompt },
                { role: "user", content: denyHandled.correctionPrompt },
              ];
              // No further actions on the failed branch.
              continue outer;
            }

            // Budget exhausted — fall back to feeding the deny back so the
            // model can at least try a different approach on this branch.
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: `Tool call denied by policy rule ${decision.ruleId}: ${decision.reason}`,
            });
            continue;
          }

          if (isMutating(tool)) {
            await this.snapAndCheckpoint("pre_tool", tc.id);
          }

          const result = await session.executeTool(tc.name, args);
          const payload = result.errorClass
            ? { error: result.errorClass, output: result.output }
            : { output: result.output };
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(payload),
          });

          // Advance the rollback point so any later autonomous recovery
          // restores to the state AFTER this allowed action — prior good
          // work survives, only the would-be violation is undone.
          if (isMutating(tool) && result.exitCode === 0) {
            await this.snapAndCheckpoint("post_tool", tc.id);
          }
        }
      }
    } catch (err) {
      this.config.onError?.(err instanceof Error ? err.message : String(err));
      finalStatus = "failed";
    }

    // Final snapshot so the post-state of the last node is recoverable.
    await this.snapAndCheckpoint("final", session.runId);

    try {
      session.end(finalStatus);
    } catch {
      /* already ended */
    }

    return {
      status: finalStatus,
      autoRecoveriesUsed: this.autoRecoveriesUsed,
      finalBranchId: this.currentBranchId,
    };
  }

  /**
   * Take a snapshot of the sandbox + emit a Nemoclaw checkpoint event with
   * the artifact metadata. The most-recent non-`pre_restore` snapshot becomes
   * the rollback target for the next autonomous recovery.
   */
  private async snapAndCheckpoint(
    kind: AgentSnapshotInput["kind"],
    contextNodeId: string,
  ): Promise<AgentSnapshotResult | null> {
    try {
      const result = await this.config.snapshotter.snapshot({
        runId: this.config.session.runId,
        branchId: this.currentBranchId,
        nodeId: contextNodeId,
        kind,
        sandboxRoot: this.config.sandboxRoot,
      });
      this.config.session.checkpoint({
        memory: {},
        policyYaml: "",
        artifactPath: result.artifactPath,
        checksum: result.checksum,
        fileCount: result.fileCount,
        kind,
      });
      if (kind !== "pre_restore") {
        this.lastFsCheckpoint = {
          cpId: result.cpId,
          artifactPath: result.artifactPath,
          manifestPath: result.manifestPath,
          nodeId: contextNodeId,
          branchId: this.currentBranchId,
        };
      }
      return result;
    } catch (err) {
      this.config.onError?.(
        `Snapshot (${kind}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Handle a Nemoclaw policy_deny autonomously: classify, restore the
   * sandbox, fork the session onto a new branch, and produce a correction
   * prompt the next turn should start from.
   */
  private async handleAutonomousRollback(input: {
    tool: AgentTool;
    decision: PolicyEvaluation;
    toolCallId: string;
    userTask: string;
    maxAutoRecoveries: number;
  }): Promise<{ recovered: true; correctionPrompt: string } | { recovered: false }> {
    if (this.autoRecoveriesUsed >= input.maxAutoRecoveries) {
      return { recovered: false };
    }
    if (!this.lastFsCheckpoint) {
      return { recovered: false };
    }

    const { session } = this.config;
    const denyNodeId = session.getLastNodeId() ?? input.toolCallId;
    const failedBranchId = this.currentBranchId;

    const classification = classifyFailure({
      openshellDecision: "deny",
      actionType: input.tool.actionType,
      evidence: [input.decision.reason, input.decision.ruleText],
    });
    const failureCategory =
      classification.policyFailureCategory ?? `policy_deny:${input.tool.actionType}`;

    // 1. Forensic snapshot of the post-violation state (dirty marker on the failed branch).
    await this.snapAndCheckpoint("pre_restore", denyNodeId);

    // 2. Restore the sandbox to the most-recent good snapshot.
    try {
      await this.config.snapshotter.extract(
        this.lastFsCheckpoint.artifactPath,
        this.config.sandboxRoot,
      );
    } catch (err) {
      this.config.onError?.(
        `Autonomous restore failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { recovered: false };
    }

    // 3. Build the correction prompt via the RecoveryOrchestrator.
    const recoveryCheckpoint: RecoveryCheckpointData = {
      id: this.lastFsCheckpoint.cpId,
      runId: session.runId,
      nodeId: this.lastFsCheckpoint.nodeId,
      branchId: this.lastFsCheckpoint.branchId,
      memory: undefined,
      context: undefined,
      prompt: undefined,
      policyYaml: undefined,
      createdAt: new Date().toISOString(),
    };
    const correctionSummary = [
      `Autonomous rollback: ${input.tool.actionType} denied by ${input.decision.ruleId}`,
      `Resource: ${input.decision.normalizedResource}`,
      `Reason: ${input.decision.reason}`,
    ].join(". ");
    const recovery = this.recoveryOrchestrator.prepareRecovery({
      checkpoint: recoveryCheckpoint,
      failedNodeId: denyNodeId,
      failureCategory,
      humanCorrection: correctionSummary,
      recoveryStrategy: "replan_within_policy",
    });

    // 4. Fork the Nemoclaw session onto a new branch.
    const newBranchId = `branch_recovery_${randomUUID().slice(0, 8)}`;
    session.forkInto({
      runId: session.runId,
      parentBranchId: failedBranchId,
      forkNodeId: denyNodeId,
      branchId: newBranchId,
      correctionSummary,
      checkpointId: this.lastFsCheckpoint.cpId,
      failureCategory,
    });
    this.currentBranchId = newBranchId;

    // 5. Eager branch persistence — consumer-supplied so AgentLoop stays
    //    decoupled from the storage layer.
    if (this.config.onBranchFork) {
      try {
        await this.config.onBranchFork({
          failedBranchId,
          newBranchId,
          forkNodeId: denyNodeId,
          failureCategory,
          correctionSummary,
          runId: session.runId,
        });
      } catch (err) {
        this.config.onError?.(
          `Branch persistence failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const correctionPrompt = [
      recovery.correctionPrompt,
      "",
      `ORIGINAL TASK: ${input.userTask}`,
      "",
      `Do NOT retry the denied action verbatim. Try a different approach that respects the policy.`,
    ].join("\n");

    return { recovered: true, correctionPrompt };
  }
}
