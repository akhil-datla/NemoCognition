#!/usr/bin/env node

import { promises as fs, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { AgentLoop, type TrackerEvent } from "@nemocognition/nemoclaw";
import { SessionRecorder, type Session } from "./recorder";
import { buildAgentTools } from "./default-tools";
import { snapper, sandboxRootForRun } from "./filesystem-snapper";

interface CliConfig {
  nimEndpoint: string;
  nimApiKey: string;
  nimModel: string;
  phoenixEndpoint: string;
  nemocognitionApiUrl?: string;
}

/**
 * Walk up from `process.cwd()` (capped at 6 levels — workspace root is at
 * most 2-3 above any package) until we find a `.env`, then merge its
 * `KEY=VALUE` pairs into `process.env`. Existing shell vars take priority.
 *
 * Tiny inline parser — avoids adding `dotenv` as a dep. Supports `#` comments,
 * blank lines, single/double-quoted values, and `KEY=VALUE` shape.
 */
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
        // Strip surrounding quotes.
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (!(key in process.env)) {
          process.env[key] = value;
        }
      }
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Vestigial env vars from the original NemoCognition design. None of these
 * are read by any code today. Warn (don't fail) when one is set so future
 * operators don't expect them to take effect.
 */
const DEAD_ENV_VARS = [
  "NEMOCLAW_RUNTIME_URL",
  "OPENSHELL_SANDBOX_NAME",
  "OPENSHELL_OCSF_JSONL_PATH",
  "OPENSHELL_AUDIT_ARTIFACT_ROOT",
  "ARTIFACT_STORAGE_ROOT",
  "ARTIFACT_REPLAY_ROOT",
  "PHOENIX_COLLECTOR_ENDPOINT",
  "PHOENIX_TRACE_ID",
] as const;

function warnOnDeadEnvVars(): void {
  const stale = DEAD_ENV_VARS.filter((k) => process.env[k] && process.env[k]!.length > 0);
  if (stale.length > 0) {
    console.error(
      `Warning: these env vars are set but unused by the current code: ${stale.join(", ")}. Safe to remove from .env.`,
    );
  }
}

function readEnv(): CliConfig | null {
  // Honour both the CLI-canonical names AND the NVIDIA_NIM_* / PHOENIX_BASE_*
  // names the .env.example and the web app use. Same fallback chain as
  // `apps/web/src/app/api/runs/[runId]/recover/route.ts`.
  const nimEndpoint =
    process.env.NIM_ENDPOINT ??
    process.env.NVIDIA_NIM_BASE_URL ??
    "https://integrate.api.nvidia.com/v1";
  const nimApiKey = process.env.NIM_API_KEY ?? "";
  const nimModel =
    process.env.NIM_MODEL ??
    process.env.NVIDIA_NIM_MODEL ??
    "nvidia/llama-3.1-nemotron-70b-instruct";
  const phoenixEndpoint =
    process.env.PHOENIX_ENDPOINT ??
    process.env.PHOENIX_BASE_URL ??
    "http://localhost:6006";
  const nemocognitionApiUrl = process.env.NEMOCOGNITION_API_URL;

  warnOnDeadEnvVars();

  if (!nimApiKey) {
    console.error("Error: NIM_API_KEY environment variable is required");
    console.error("Tip: put it in `.env` at the repo root; the CLI auto-loads it.");
    return null;
  }
  return { nimEndpoint, nimApiKey, nimModel, phoenixEndpoint, nemocognitionApiUrl };
}

async function finalize(session: Session, status: string): Promise<void> {
  session.end(status);
  const result = await session.flushToBackends();
  console.log("");
  console.log(`Phoenix export: ${result.phoenix.ok ? "ok" : `FAILED — ${result.phoenix.error}`}`);
  if (result.api.skipped) {
    console.log("API import: skipped (NEMOCOGNITION_API_URL unset)");
  } else {
    console.log(`API import: ${result.api.ok ? "ok" : `FAILED — ${result.api.error}`}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Auto-load .env from the nearest ancestor directory before any command
  // reads process.env. Shell-set vars take priority.
  const envFile = loadDotEnv();
  if (envFile && command !== "--help" && command !== "-h") {
    console.error(`Loaded env from ${envFile}`);
  }

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  const env = readEnv();
  if (!env) process.exit(1);

  if (command === "record") {
    const title = args[1] ?? "Untitled session";
    const userTask = args.slice(2).join(" ") || title;

    const recorder = new SessionRecorder(env);
    const session = recorder.start({ title, userTask });

    console.log(`Session: ${session.runId}`);
    console.log(`Branch: ${session.branchId}`);
    console.log(`Provider: nvidia | Model: nemotron`);
    console.log(`Phoenix: ${env.phoenixEndpoint}`);
    console.log(`API: ${env.nemocognitionApiUrl ?? "(unset — skipping)"}`);
    console.log(`\nType messages to chat with the agent.`);
    console.log(`Commands: /end, /spans, /checkpoint, /memory <k>=<v>\n`);

    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
    rl.prompt();

    rl.on("close", async () => {
      await finalize(session, "completed");
      console.log("Session ended.");
      process.exit(0);
    });

    rl.on("line", async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) {
        rl.prompt();
        return;
      }

      if (trimmed === "/end") {
        rl.close();
        return;
      }

      if (trimmed === "/spans") {
        console.log(JSON.stringify(session.exportSpans(), null, 2));
        rl.prompt();
        return;
      }

      if (trimmed === "/checkpoint") {
        const cpId = session.checkpoint({ memory: {}, policyYaml: "" });
        console.log(`Checkpoint created: ${cpId}`);
        rl.prompt();
        return;
      }

      if (trimmed.startsWith("/memory ")) {
        const rest = trimmed.slice("/memory ".length);
        const eq = rest.indexOf("=");
        if (eq < 0) {
          console.log("Usage: /memory <key>=<value>");
        } else {
          session.captureMemory(rest.slice(0, eq).trim(), rest.slice(eq + 1).trim());
          console.log("Memory captured.");
        }
        rl.prompt();
        return;
      }

      try {
        const response = await session.chat(trimmed);
        console.log(`\n${response.content ?? "(no content)"}\n`);
        if (response.toolCalls?.length) {
          console.log(`Tool calls requested: ${response.toolCalls.map((t) => t.name).join(", ")}`);
        }
      } catch (err) {
        console.error(`Chat failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      rl.prompt();
    });
  } else if (command === "demo") {
    const recorder = new SessionRecorder({
      ...env,
      nimChat: async () => ({
        content: "I'll research scaling laws from the allowed documents.",
        tokenCount: { input: 50, output: 30 },
        finishReason: "stop",
      }),
    });

    const session = recorder.start({
      title: "Demo: Research Report",
      userTask: "Create a report from allowed research docs",
    });

    console.log(`Demo session: ${session.runId}`);

    await session.chat("Research scaling laws from allowed docs");

    session.registerTool({
      name: "read_file",
      description: "Read a file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
      execute: async (a) => ({ content: `Contents of ${a.path}` }),
    });

    await session.executeTool("read_file", { path: "./research/paper.md" });

    session.recordPolicy({
      actionType: "file_read",
      decision: "allow",
      resource: "./research/paper.md",
      normalizedResource: "./research/**",
      policyRuleId: "rule_1",
      policyRuleText: "allow_read: ./research/**",
      policyPath: "files.allow_read[0]",
      reason: "Matches allow pattern",
      actor: "openshell",
    });

    session.recordPolicy({
      actionType: "file_read",
      decision: "deny",
      resource: "./private/api_keys.txt",
      normalizedResource: "./private/**",
      policyRuleId: "rule_2",
      policyRuleText: "deny_read: ./private/**",
      policyPath: "files.deny_read[0]",
      reason: "Matches deny pattern",
      actor: "openshell",
    });

    session.checkpoint({ memory: { step: "research" }, policyYaml: "files:\n  allow_read:\n    - ./research/**" });
    await finalize(session, "completed");
    console.log("Demo complete.");
  } else if (command === "agent") {
    await runAgentCommand(env, args.slice(1));
  } else {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }
}

/**
 * `nemoclaw-record agent <task>` — run a single autonomous Nemoclaw agent
 * task end-to-end via {@link AgentLoop}.
 *
 * The loop is driven by the same Nemoclaw primitives the web runner uses:
 *   - NimClient + Nemotron via `Session.chatMessages`
 *   - `evaluatePolicy` + `DEFAULT_POLICY` for every tool call
 *   - Filesystem `Snapper` for pre/post-tool snapshots
 *   - Autonomous rollback + recovery branch on policy_deny (via
 *     `tracker.branchOff` + `RecoveryOrchestrator`)
 *
 * Tracker events stream to stdout live so the operator can watch policy
 * decisions, snapshots, and recovery forks as they happen.
 */
async function runAgentCommand(env: CliConfig, rest: string[]): Promise<void> {
  if (rest.length === 0) {
    console.error("Error: `agent` requires a task description. Example:");
    console.error('  nemoclaw-record agent "Inspect this repo and summarise the build"');
    process.exit(1);
  }
  const userTask = rest.join(" ");
  const title = userTask.length > 80 ? `${userTask.slice(0, 77)}…` : userTask;

  // Stream tracker events live as the loop progresses.
  const onTrackerEvent = (e: TrackerEvent) => printAgentEvent(e);

  const recorder = new SessionRecorder({ ...env, onTrackerEvent });
  const session = recorder.start({ title, userTask });

  // Sandbox root — under sandboxes/<runId>, so the agent's writes/commands
  // don't touch the operator's repo. Override with SANDBOX_STORAGE_ROOT
  // (handled inside `sandboxRootForRun`).
  const sandboxRoot = sandboxRootForRun(session.runId);
  await fs.mkdir(sandboxRoot, { recursive: true });

  console.log(`Run: ${session.runId}`);
  console.log(`Branch: ${session.branchId}`);
  console.log(`Sandbox: ${sandboxRoot}`);
  console.log(`Provider: nvidia | Model: ${env.nimModel}`);
  console.log(`Phoenix: ${env.phoenixEndpoint}`);
  console.log(`API: ${env.nemocognitionApiUrl ?? "(unset — Phoenix-only)"}`);
  console.log(`Task: ${userTask}\n`);
  console.log("--- live events ---");

  const loop = new AgentLoop({
    session,
    tools: buildAgentTools(sandboxRoot),
    sandboxRoot,
    snapshotter: snapper,
    onError: (message) => console.error(`[loop error] ${message}`),
  });

  const result = await loop.run(userTask);

  console.log("\n--- run summary ---");
  console.log(`Status: ${result.status}`);
  console.log(`Auto-recoveries used: ${result.autoRecoveriesUsed}`);
  console.log(`Final branch: ${result.finalBranchId}`);

  // Phoenix + replay-API flush (best-effort; failures are reported, not thrown).
  const flush = await session.flushToBackends();
  console.log("");
  console.log(`Phoenix export: ${flush.phoenix.ok ? "ok" : `FAILED — ${flush.phoenix.error}`}`);
  if (flush.api.skipped) {
    console.log("API import: skipped (NEMOCOGNITION_API_URL unset)");
  } else {
    console.log(`API import: ${flush.api.ok ? "ok" : `FAILED — ${flush.api.error}`}`);
  }
  console.log(`Sandbox left at: ${path.resolve(sandboxRoot)}`);
}

/** Compact, one-line per-event renderer for stdout. */
function printAgentEvent(e: TrackerEvent): void {
  const t = e.type;
  const a = e.attributes as Record<string, unknown>;
  switch (t) {
    case "run_start":
      console.log(`[start]    run=${e.runId} task=${String(a.userTask ?? "")}`);
      return;
    case "model_call_start":
      console.log(`[model →]  prompt=${String(a.promptRef ?? "").slice(0, 80)}`);
      return;
    case "model_call_end": {
      const tokens = a.tokenCount as { input: number; output: number } | undefined;
      console.log(`[model ←]  ${tokens?.output ?? "?"} out / ${tokens?.input ?? "?"} in, ${String(a.latencyMs ?? "?")}ms`);
      return;
    }
    case "tool_call_start":
      console.log(`[tool →]   ${String(a.toolName)}  ${String(a.inputJson ?? "").slice(0, 120)}`);
      return;
    case "tool_call_end":
      console.log(`[tool ←]   exit=${a.exitCode}${a.errorClass ? ` error=${a.errorClass}` : ""}`);
      return;
    case "policy_allow":
      console.log(`[allow]    ${a.actionType}: ${a.resource}`);
      return;
    case "policy_deny":
      console.log(`[DENY]     ${a.actionType}: ${a.resource}  (${a.policyRuleId})  reason=${a.reason}`);
      return;
    case "checkpoint":
      console.log(`[cp ${String(a.kind ?? "?")}]  ${String(a.checkpointId ?? "?")}  ${a.fileCount ?? "?"} files`);
      return;
    case "branch_start":
      console.log(`[FORK ⤴]   new branch=${e.branchId} from ${String(a.forkNodeId ?? "?")}  failure=${String(a.failureCategory ?? "?")}`);
      return;
    case "run_end":
      console.log(`[end]      status=${a.status}`);
      return;
    default:
      console.log(`[${t}]`);
  }
}

function printUsage() {
  console.log(`
nemoclaw-record — NemoCognition CLI session recorder

Records NemoClaw agent sessions running on NVIDIA Brev with NVIDIA Nemotron
via NIM, emits OpenInference spans to Arize Phoenix, and (optionally) POSTs the
recorded trace to the NemoCognition web app for replay.

Usage:
  nemoclaw-record agent <task description>            Run an autonomous Nemoclaw agent task with policy gating and autonomous rollback (RECOMMENDED)
  nemoclaw-record record <title> [task description]   Start an interactive chat-only recording session
  nemoclaw-record demo                                Run a scripted demo (no NIM calls)
  nemoclaw-record --help                              Show this help

Environment:
  NIM_API_KEY              NVIDIA NIM API key (required)
  NIM_ENDPOINT             NIM endpoint (default: https://integrate.api.nvidia.com/v1)
  NIM_MODEL                NIM model (default: nvidia/llama-3.1-nemotron-70b-instruct)
  PHOENIX_ENDPOINT         Arize Phoenix HTTP endpoint (default: http://localhost:6006)
  NEMOCOGNITION_API_URL    NemoCognition web app URL for replay import (optional)
  SANDBOX_STORAGE_ROOT     Root dir under which per-run sandboxes are created (default: ./sandboxes)
  CHECKPOINT_STORAGE_ROOT  Root dir under which snapshot archives are written  (default: ./checkpoints)

Interactive record-session commands:
  /end                End the session and flush spans
  /spans              Print current spans as JSON
  /checkpoint         Create a checkpoint
  /memory key=val     Capture a memory update
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
