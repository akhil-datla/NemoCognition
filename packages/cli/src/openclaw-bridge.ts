#!/usr/bin/env node
/**
 * NemoGraph ⇄ real NemoClaw / OpenClaw bridge.
 *
 * Runs on the Brev VM that has `nemoclaw` and `openshell` CLIs installed
 * and an onboarded NemoClaw sandbox (e.g. `nemograph`). For a given task,
 * this bridge:
 *
 *   1. Snapshots the sandbox via `nemoclaw <sandbox> snapshot create` so
 *      we have a deterministic rollback target.
 *   2. Invokes `openclaw agent --json` through `openshell sandbox exec`
 *      so the task runs under real OpenShell Landlock/seccomp/netns gating
 *      with the user-onboarded policy file.
 *   3. Parses OpenClaw's JSON output for failure signals
 *      (`stopReason !== "stop"`, `executionTrace.attempts[*].result`,
 *      `replayInvalid`, error envelopes, exit code != 0).
 *   4. On failure: takes a forensic `pre-restore` snapshot, then
 *      `nemoclaw <sandbox> snapshot restore <baseline> --to <fork-sandbox>`
 *      — NemoClaw materialises a new sandbox container from the snapshot.
 *      That new sandbox is the recovery branch.
 *   5. Re-invokes openclaw agent on the recovery sandbox with a correction
 *      prompt synthesised from the failure category, until the run is
 *      "all green" or the recovery budget is exhausted.
 *   6. Emits Nemoclaw-style TrackerEvents throughout so a downstream
 *      replay UI (Phoenix or our own) can render the run + fork graph.
 *
 * This file deliberately does not depend on our in-process AgentLoop. It is
 * the real-NemoClaw counterpart: same architectural beats, different
 * substrate. Both share `@nemocognition/nemoclaw` for the event/tracker
 * shape and the recovery prompt builder.
 */

import { spawnSync, spawn } from "node:child_process";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { RuntimeTracker, type TrackerEvent } from "@nemocognition/nemoclaw";
import { RecoveryOrchestrator } from "@nemocognition/recovery";
import { classifyFailure } from "@nemocognition/core";

// ─── env loader (mirrors bin.ts) ────────────────────────────────────────────
function loadDotEnv(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) {
      const raw = readFileSync(candidate, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
      }
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ─── shell helpers ──────────────────────────────────────────────────────────
function runSync(cmd: string, args: string[], opts: { input?: string; cwd?: string } = {}): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const r = spawnSync(cmd, args, {
    input: opts.input,
    cwd: opts.cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    exitCode: typeof r.status === "number" ? r.status : -1,
  };
}

// ─── nemoclaw + openshell wrappers ──────────────────────────────────────────
interface SnapshotInfo {
  version: string; // "v1", "v2", ...
  name: string;
  timestamp: string;
  path: string;
}

function snapshotCreate(sandbox: string, name: string): SnapshotInfo {
  const r = runSync("nemoclaw", [sandbox, "snapshot", "create", "--name", name]);
  if (r.exitCode !== 0) {
    throw new Error(`snapshot create failed: ${r.stderr || r.stdout}`);
  }
  // Parse: "✓ Snapshot v3 name=baseline created (... dirs, ... files)\n    /path/to/snap"
  const versionMatch = r.stdout.match(/Snapshot (v\d+) name=(\S+) created/);
  const pathMatch = r.stdout.match(/(\/[^\s\n]+)/);
  if (!versionMatch || !pathMatch) {
    throw new Error(`snapshot create: unparseable output: ${r.stdout}`);
  }
  return {
    version: versionMatch[1],
    name: versionMatch[2],
    timestamp: new Date().toISOString(),
    path: pathMatch[1],
  };
}

function snapshotRestoreInto(sandbox: string, selector: string, destSandbox: string): void {
  const r = runSync("nemoclaw", [sandbox, "snapshot", "restore", selector, "--to", destSandbox]);
  if (r.exitCode !== 0) {
    throw new Error(`snapshot restore failed: ${r.stderr || r.stdout}`);
  }
}

interface OpenClawResult {
  rawJson: unknown;
  finalText: string | null;
  stopReason: string | null;
  livenessState: string | null;
  replayInvalid: boolean;
  executionTrace: {
    winnerProvider: string | null;
    winnerModel: string | null;
    attempts: Array<{ provider?: string; model?: string; result?: string; stage?: string }>;
    fallbackUsed: boolean;
    runner: string | null;
  };
  toolCalls: Array<{ name: string; arguments: unknown; output?: unknown; error?: string }>;
  exitCode: number;
  durationMs: number;
}

/**
 * Run a single openclaw agent turn in the given sandbox and parse the JSON
 * envelope.  The agent runs under real OpenShell gating; any policy
 * violation surfaces here as a non-stop stopReason, a tool error, or a
 * non-zero exit code.
 */
function openclawAgent(sandbox: string, sessionId: string, message: string): OpenClawResult {
  const start = Date.now();
  // openshell sandbox exec routes via gRPC and rejects args containing CR/LF
  // ("InvalidArgument: command argument N contains newline or carriage return
  // characters"). Collapse whitespace so multi-line recovery prompts survive
  // the call. The agent still parses the prompt fine because OpenClaw
  // tokenises on whitespace.
  const safeMessage = message.replace(/\r\n|\r|\n/g, " · ").replace(/\s{2,}/g, " ");
  const r = runSync("openshell", [
    "sandbox",
    "exec",
    "-n",
    sandbox,
    "--no-tty",
    "--",
    "openclaw",
    "agent",
    "--agent",
    "main",
    "--json",
    "--session-id",
    sessionId,
    "-m",
    safeMessage,
  ]);
  const durationMs = Date.now() - start;
  if (r.exitCode !== 0) {
    console.log(`[bridge-debug] openclaw exited ${r.exitCode} on sandbox=${sandbox}`);
    console.log(`[bridge-debug] stderr: ${r.stderr.slice(0, 1000)}`);
    console.log(`[bridge-debug] stdout tail: ${r.stdout.slice(-1000)}`);
  }

  // Find the JSON envelope in stdout. OpenClaw prints some non-JSON warnings
  // first (UNDICI deprecation, banner), then the JSON envelope.
  let parsed: any = null;
  const jsonStart = r.stdout.indexOf("\n{");
  const candidate = jsonStart >= 0 ? r.stdout.slice(jsonStart + 1) : r.stdout;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    // Fall back: scan for first { and try
    const i = candidate.indexOf("{");
    if (i >= 0) {
      try {
        parsed = JSON.parse(candidate.slice(i));
      } catch {
        parsed = null;
      }
    }
  }

  // OpenClaw's --json envelope wraps the agent payload like:
  //   { status, summary, runId, result: { meta: { ...agent payload... }, payloads: [...] } }
  // The `meta` is where `replayInvalid`, `stopReason`, `finalAssistantVisibleText`,
  // `executionTrace`, `toolSummary` live. Probe a few common shapes for forward-compat.
  const candidates = [
    parsed?.result?.meta,
    parsed?.data?.result?.meta,
    parsed?.data,
    parsed?.result,
    parsed,
  ];
  let inner: any = {};
  for (const c of candidates) {
    if (c && (c.finalAssistantVisibleText != null || c.replayInvalid != null || c.stopReason != null)) {
      inner = c;
      break;
    }
  }
  if (process.env.BRIDGE_DEBUG) {
    try {
      writeFileSync(`/tmp/bridge-debug-${Date.now()}.json`, JSON.stringify({ parsed, picked: inner }, null, 2));
    } catch { /* ignore */ }
  }
  const trace = inner.executionTrace ?? {};
  const toolCalls: OpenClawResult["toolCalls"] = [];
  const toolCallSrc = inner.toolCalls ?? inner.tools ?? [];
  if (Array.isArray(toolCallSrc)) {
    for (const tc of toolCallSrc) {
      toolCalls.push({
        name: tc?.name ?? "?",
        arguments: tc?.arguments ?? tc?.args ?? null,
        output: tc?.output ?? tc?.result,
        error: tc?.error ?? tc?.errorMessage,
      });
    }
  }

  return {
    rawJson: parsed,
    finalText: inner.finalAssistantVisibleText ?? inner.finalAssistantRawText ?? null,
    stopReason: inner.stopReason ?? inner.completion?.stopReason ?? null,
    livenessState: inner.livenessState ?? null,
    replayInvalid: Boolean(inner.replayInvalid),
    executionTrace: {
      winnerProvider: trace.winnerProvider ?? null,
      winnerModel: trace.winnerModel ?? null,
      attempts: Array.isArray(trace.attempts) ? trace.attempts : [],
      fallbackUsed: Boolean(trace.fallbackUsed),
      runner: trace.runner ?? null,
    },
    toolCalls,
    exitCode: r.exitCode,
    durationMs,
  };
}

/**
 * Detect whether an OpenClaw result represents an OpenShell-gated failure or
 * other recoverable error condition. Returns a structured failure record or
 * null if the run is "green".
 */
interface FailureSignal {
  category: string;
  evidence: string[];
  toolError?: string;
}

function detectFailure(r: OpenClawResult): FailureSignal | null {
  // CLI-level failure (e.g. openclaw crashed, gateway unreachable, sandbox missing)
  if (r.exitCode !== 0) {
    return {
      category: "openclaw-exit-nonzero",
      evidence: [`openclaw exit code ${r.exitCode}`, r.stopReason ?? "no stopReason"],
    };
  }

  // `replayInvalid: true` means OpenShell intervened during this turn — but
  // OpenClaw's agent can sometimes recover within the SAME turn (e.g. tries
  // /etc/foo → denied → pivots to /tmp/foo → succeeds). In that case the
  // user-visible task is actually complete and we should NOT fork.
  //
  // Distinguish "intervened, didn't recover" from "intervened, recovered
  // mid-turn" by inspecting the final assistant text. A successful in-turn
  // recovery contains explicit completion language; a true failure mostly
  // contains error output.
  if (r.replayInvalid) {
    const finalText = r.finalText ?? "";
    const completionRegex = /\b(has been persisted|persisted to|successfully (?:created|wrote|written|saved)|written to|saved to|created at|file exists|file has been (?:created|written|saved)|wrote the file|task complete)\b/i;
    const recoveredInTurn = completionRegex.test(finalText);
    if (recoveredInTurn) {
      // OpenShell intervened, but the agent already pivoted to an allowed
      // resource and completed the task in this single turn.
      return null;
    }
    const permMatch = finalText.match(/Permission denied[^\n]*/i);
    return {
      category: "openshell-policy-denied",
      evidence: [
        "replayInvalid=true",
        permMatch ? permMatch[0].slice(0, 200) : `stopReason=${r.stopReason ?? "?"}`,
        `finalText[0:120]=${finalText.slice(0, 120)}`,
      ],
      toolError: permMatch ? permMatch[0] : undefined,
    };
  }

  // Per-tool failure tally from OpenClaw's `toolSummary` (when present).
  const summary = (r.rawJson as any)?.data?.toolSummary ?? (r.rawJson as any)?.toolSummary;
  if (summary && typeof summary.failures === "number" && summary.failures > 0) {
    return {
      category: "tool-failures-reported",
      evidence: [`toolSummary.failures=${summary.failures}`, `tools=${(summary.tools ?? []).join(",")}`],
    };
  }

  // Tool-level failure: any tool call we extracted with an error / non-success result
  for (const tc of r.toolCalls) {
    if (tc.error) {
      return {
        category: "tool-error",
        evidence: [`tool=${tc.name}`, `error=${String(tc.error).slice(0, 200)}`],
        toolError: String(tc.error),
      };
    }
    const out = tc.output as any;
    if (out && (out.exitCode != null && out.exitCode !== 0)) {
      return {
        category: "tool-nonzero-exit",
        evidence: [`tool=${tc.name}`, `exitCode=${out.exitCode}`, `stderr=${String(out.stderr ?? "").slice(0, 200)}`],
        toolError: String(out.stderr ?? "").slice(0, 200),
      };
    }
  }

  // Inference-level failure: every attempt failed
  if (r.executionTrace.attempts.length > 0 && !r.executionTrace.attempts.some((a) => a.result === "success")) {
    return {
      category: "inference-failed",
      evidence: r.executionTrace.attempts.map((a) => `${a.provider}/${a.model}=${a.result}`),
    };
  }

  // Liveness states other than "working" or absent
  if (r.livenessState && !["working", "ready", null].includes(r.livenessState)) {
    return {
      category: `liveness-${r.livenessState}`,
      evidence: [`livenessState=${r.livenessState}`, `stopReason=${r.stopReason ?? "?"}`],
    };
  }

  return null;
}

// ─── main bridge orchestrator ───────────────────────────────────────────────
interface BridgeConfig {
  sandbox: string;
  task: string;
  maxRecoveries: number;
}

async function runBridge(cfg: BridgeConfig): Promise<void> {
  loadDotEnv();

  const tracker = new RuntimeTracker({
    onEvent: (e) => printEvent(e),
    phoenixEndpoint: process.env.PHOENIX_ENDPOINT ?? process.env.PHOENIX_BASE_URL ?? "http://localhost:6006",
  });
  const orchestrator = new RecoveryOrchestrator();

  const { runId, branchId } = tracker.startRun({ title: cfg.task.slice(0, 80), userTask: cfg.task });
  console.log(`\nRun: ${runId}`);
  console.log(`Branch: ${branchId}`);
  console.log(`Sandbox: ${cfg.sandbox} (real OpenShell-gated NemoClaw sandbox)`);
  console.log(`Task: ${cfg.task}\n--- live events ---`);

  // Baseline snapshot — rollback target if the very first action fails.
  let lastGoodSnapshot: SnapshotInfo;
  try {
    lastGoodSnapshot = snapshotCreate(cfg.sandbox, `baseline-${runId.slice(4, 12)}`);
    tracker.createCheckpoint({
      memory: {},
      policyYaml: "",
      artifactPath: lastGoodSnapshot.path,
      fileCount: 0,
      kind: "manual",
    });
  } catch (err) {
    console.error(`Failed to create baseline snapshot: ${err instanceof Error ? err.message : String(err)}`);
    tracker.endRun("failed");
    return;
  }

  let currentSandbox = cfg.sandbox;
  let currentSessionId = `nemograph-${runId.slice(4, 12)}-0`;
  let currentTask = cfg.task;
  let recoveriesUsed = 0;
  let finalStatus: "completed" | "failed" = "completed";

  for (let attempt = 0; attempt <= cfg.maxRecoveries; attempt++) {
    // Snapshot before invoking the agent (pre-tool semantics).
    let preInvokeSnap: SnapshotInfo | null = null;
    try {
      preInvokeSnap = snapshotCreate(currentSandbox, `pre-invoke-${runId.slice(4, 12)}-${attempt}`);
      tracker.createCheckpoint({
        memory: {},
        policyYaml: "",
        artifactPath: preInvokeSnap.path,
        fileCount: 0,
        kind: "pre_tool",
      });
    } catch (err) {
      console.error(`[snap-warn] ${err instanceof Error ? err.message : String(err)}`);
    }

    // Invoke openclaw agent in the (possibly recovery) sandbox.
    const callId = tracker.beforeModelCall({
      promptRef: currentTask.slice(0, 200),
      contextRef: `sandbox=${currentSandbox}`,
      messages: [{ role: "user", content: currentTask }],
    });
    const result = openclawAgent(currentSandbox, currentSessionId, currentTask);
    tracker.afterModelCall(callId, {
      outputRef: result.finalText ?? "(no text)",
      outputMessage: { role: "assistant", content: result.finalText ?? "" },
      tokenCount: { input: 0, output: 0 },
      latencyMs: result.durationMs,
      toolCallsValid: result.toolCalls.length > 0,
    });

    for (const tc of result.toolCalls) {
      const tcId = tracker.beforeToolCall({
        toolName: tc.name,
        inputJson: JSON.stringify(tc.arguments ?? {}),
      });
      tracker.afterToolCall(tcId, {
        outputRef: tc.output ? JSON.stringify(tc.output).slice(0, 1000) : null,
        exitCode: tc.error ? 1 : 0,
        durationMs: 0,
        errorClass: tc.error ? "ToolError" : null,
        filesTouched: [],
      });
    }

    const failure = detectFailure(result);
    if (!failure) {
      tracker.validate({ status: "pass", evidence: [`stopReason=${result.stopReason}`, `finalText=${(result.finalText ?? "").slice(0, 80)}`] });
      console.log(`\n✓ Task completed by OpenClaw on sandbox=${currentSandbox}`);
      if (result.finalText) console.log(`Final answer: ${result.finalText.slice(0, 400)}`);
      break;
    }

    // ── Autonomous recovery ──
    if (recoveriesUsed >= cfg.maxRecoveries) {
      console.log(`\n✗ Recovery budget exhausted (used=${recoveriesUsed}). Final failure: ${failure.category}`);
      finalStatus = "failed";
      break;
    }

    // Classify via the same NemoClaw failure-classifier the in-process loop uses.
    const classification = classifyFailure({
      openshellDecision: "deny",
      actionType: "command_execution",
      evidence: failure.evidence,
    });
    const failureCategory = classification.policyFailureCategory ?? failure.category;

    // Forensic snapshot.
    let preRestoreSnap: SnapshotInfo | null = null;
    try {
      preRestoreSnap = snapshotCreate(currentSandbox, `pre-restore-${runId.slice(4, 12)}-${attempt}`);
      tracker.recordPolicyDecision({
        actionType: "command_execution",
        decision: "deny",
        resource: failure.toolError ?? failure.category,
        normalizedResource: failure.toolError ?? failure.category,
        policyRuleId: `openshell:${failure.category}`,
        policyRuleText: `OpenShell denied: ${failure.evidence.join("; ")}`,
        policyPath: "openshell/sandbox-policy",
        reason: failure.evidence.join("; "),
        actor: "openshell",
      });
      tracker.createCheckpoint({
        memory: {},
        policyYaml: "",
        artifactPath: preRestoreSnap.path,
        fileCount: 0,
        kind: "pre_restore",
      });
    } catch (err) {
      console.error(`[snap-warn] pre-restore: ${err instanceof Error ? err.message : String(err)}`);
    }

    // FORK: restore the last-good snapshot into a brand-new sandbox.
    const forkSandbox = `${cfg.sandbox}-recovery-${attempt + 1}`;
    try {
      snapshotRestoreInto(cfg.sandbox, lastGoodSnapshot.version, forkSandbox);
    } catch (err) {
      console.error(`Failed to fork sandbox: ${err instanceof Error ? err.message : String(err)}`);
      finalStatus = "failed";
      break;
    }

    // Build correction prompt via the orchestrator.
    const recovery = orchestrator.prepareRecovery({
      checkpoint: {
        id: lastGoodSnapshot.version,
        runId,
        nodeId: tracker.getLastNodeId() ?? "?",
        branchId: tracker.getBranchId() ?? "?",
        createdAt: lastGoodSnapshot.timestamp,
      },
      failedNodeId: tracker.getLastNodeId() ?? "?",
      failureCategory,
      humanCorrection: `OpenShell denied: ${failure.evidence.join("; ")}`,
      recoveryStrategy: "replan_within_policy",
    });

    // Emit branch_start so the trace shows the fork on a new branch lane.
    const newBranchId = `branch_recovery_${randomUUID().slice(0, 8)}`;
    tracker.branchOff({
      runId,
      parentBranchId: tracker.getBranchId()!,
      forkNodeId: tracker.getLastNodeId() ?? "?",
      branchId: newBranchId,
      correctionSummary: `Autonomous rollback via NemoClaw snapshot ${lastGoodSnapshot.version} → ${forkSandbox}`,
      checkpointId: lastGoodSnapshot.version,
      failureCategory,
    });

    console.log(`\n⤴ FORK: ${currentSandbox} → ${forkSandbox} (failure=${failureCategory})`);
    console.log(`   correction prompt:\n   ${recovery.correctionPrompt.replace(/\n/g, "\n   ")}\n`);

    currentSandbox = forkSandbox;
    currentSessionId = `nemograph-${runId.slice(4, 12)}-${attempt + 1}`;
    currentTask = `${recovery.correctionPrompt}\n\nORIGINAL TASK: ${cfg.task}\n\nDo NOT retry the failed action verbatim.`;
    recoveriesUsed += 1;
  }

  tracker.endRun(finalStatus);

  console.log("\n--- run summary ---");
  console.log(`Status: ${finalStatus}`);
  console.log(`Recoveries used: ${recoveriesUsed}`);
  console.log(`Final sandbox: ${currentSandbox}`);

  // Best-effort post to the NemoCognition API for replay UI persistence.
  const apiUrl = process.env.NEMOCOGNITION_API_URL;
  if (apiUrl) {
    try {
      const events = tracker.getEvents();
      const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/api/runs/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events }),
      });
      console.log(`API import: ${res.ok ? "ok" : `FAILED (${res.status})`}`);
    } catch (err) {
      console.log(`API import: FAILED (${err instanceof Error ? err.message : String(err)})`);
    }
  } else {
    console.log("API import: skipped (NEMOCOGNITION_API_URL unset)");
  }
}

function printEvent(e: TrackerEvent): void {
  const a = e.attributes as Record<string, unknown>;
  switch (e.type) {
    case "run_start":
      console.log(`[start]    run=${e.runId}`);
      return;
    case "model_call_start":
      console.log(`[openclaw →]  ${String(a.promptRef ?? "").slice(0, 100)}`);
      return;
    case "model_call_end":
      console.log(`[openclaw ←]  latency=${a.latencyMs}ms`);
      return;
    case "tool_call_start":
      console.log(`[tool →]   ${a.toolName}  ${String(a.inputJson ?? "").slice(0, 120)}`);
      return;
    case "tool_call_end":
      console.log(`[tool ←]   exit=${a.exitCode}${a.errorClass ? ` error=${a.errorClass}` : ""}`);
      return;
    case "policy_deny":
      console.log(`[OPENSHELL DENY]  ${a.actionType}: ${String(a.resource ?? "").slice(0, 120)}  rule=${a.policyRuleId}`);
      return;
    case "checkpoint":
      console.log(`[cp ${a.kind}]  ${a.artifactPath}`);
      return;
    case "branch_start":
      console.log(`[FORK ⤴]   parent=${a.parentBranchId} failure=${a.failureCategory}`);
      return;
    case "validation":
      console.log(`[validate]  ${a.status}`);
      return;
    case "run_end":
      console.log(`[end]      status=${a.status}`);
      return;
    default:
      console.log(`[${e.type}]`);
  }
}

// ─── CLI entrypoint ────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const sandboxIdx = args.findIndex((a) => a === "--sandbox" || a === "-s");
  const sandbox = sandboxIdx >= 0 ? args[sandboxIdx + 1] : process.env.NEMOCLAW_SANDBOX ?? "nemograph";
  const maxIdx = args.findIndex((a) => a === "--max-recoveries");
  const maxRecoveries = maxIdx >= 0 ? Number(args[maxIdx + 1]) : 2;
  const taskParts = args.filter((_, i) => {
    if (i === sandboxIdx || i === sandboxIdx + 1) return false;
    if (i === maxIdx || i === maxIdx + 1) return false;
    return true;
  });
  const task = taskParts.join(" ").trim();

  if (!task) {
    console.error("Usage: openclaw-bridge [--sandbox <name>] [--max-recoveries N] <task>");
    process.exit(1);
  }

  await runBridge({ sandbox, task, maxRecoveries });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
