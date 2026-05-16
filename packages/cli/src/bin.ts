#!/usr/bin/env node

import { SessionRecorder, type Session } from "./recorder";
import { createInterface } from "node:readline";

interface CliConfig {
  nimEndpoint: string;
  nimApiKey: string;
  nimModel: string;
  phoenixEndpoint: string;
  nemocognitionApiUrl?: string;
}

function readEnv(): CliConfig | null {
  const nimEndpoint = process.env.NIM_ENDPOINT ?? "https://integrate.api.nvidia.com/v1";
  const nimApiKey = process.env.NIM_API_KEY ?? "";
  const nimModel = process.env.NIM_MODEL ?? "nvidia/llama-3.1-nemotron-70b-instruct";
  const phoenixEndpoint = process.env.PHOENIX_ENDPOINT ?? "http://localhost:6006";
  const nemocognitionApiUrl = process.env.NEMOCOGNITION_API_URL;

  if (!nimApiKey) {
    console.error("Error: NIM_API_KEY environment variable is required");
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
  } else {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }
}

function printUsage() {
  console.log(`
nemoclaw-record — NemoCognition CLI session recorder

Records NemoClaw agent sessions running on NVIDIA Brev with NVIDIA Nemotron
via NIM, emits OpenInference spans to Arize Phoenix, and (optionally) POSTs the
recorded trace to the NemoCognition web app for replay.

Usage:
  nemoclaw-record record <title> [task description]   Start an interactive recording session
  nemoclaw-record demo                                Run a scripted demo (no NIM calls)
  nemoclaw-record --help                              Show this help

Environment:
  NIM_API_KEY              NVIDIA NIM API key (required)
  NIM_ENDPOINT             NIM endpoint (default: https://integrate.api.nvidia.com/v1)
  NIM_MODEL                NIM model (default: nvidia/llama-3.1-nemotron-70b-instruct)
  PHOENIX_ENDPOINT         Arize Phoenix HTTP endpoint (default: http://localhost:6006)
  NEMOCOGNITION_API_URL    NemoCognition web app URL for replay import (optional)

Session commands:
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
