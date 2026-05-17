"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface TerminalLine {
  id: number;
  type: "input" | "output" | "error" | "system";
  text: string;
}

/**
 * Human-readable single-line label for a streamed TrackerEvent. Returns null
 * for events that aren't interesting to surface in the terminal output (the
 * tool start/end pairs collapse into a single tool_call line in the UI, but
 * here we surface every event for transparency).
 */
function formatEventLabel(ev: { type: string; attributes?: Record<string, unknown> }): string | null {
  const a = ev.attributes ?? {};
  switch (ev.type) {
    case "run_start":
      return `run_start              ${a.title ?? ""}`;
    case "model_call_start":
      return `model_call_start       prompt=${String(a.promptRef ?? "").slice(0, 50)}...`;
    case "model_call_end": {
      const tc = a.tokenCount as { input?: number; output?: number } | undefined;
      return `model_call_end         ${tc ? `${tc.input}→${tc.output} tokens` : ""} ${a.latencyMs ?? "?"}ms`;
    }
    case "tool_call_start":
      return `tool_call_start        ${a.toolName ?? ""}(${String(a.inputJson ?? "")})`;
    case "tool_call_end":
      return `tool_call_end          exit=${a.exitCode ?? "?"} ${a.errorClass ? `err=${a.errorClass}` : ""}`;
    case "policy_allow":
      return `policy_allow           ${a.actionType ?? ""} ${a.resource ?? ""}`;
    case "policy_deny":
      return `policy_deny     ⊘      ${a.actionType ?? ""} ${a.resource ?? ""}`;
    case "memory_update":
      return `memory_update          ${a.key ?? ""}=${String(a.value ?? "").slice(0, 40)}`;
    case "checkpoint":
      return `checkpoint             ${String(a.checkpointId ?? "").slice(0, 24)}`;
    case "run_end":
      return `run_end                status=${a.status ?? ""}`;
    default:
      return `${ev.type}`;
  }
}

// ASCII title rendered as a single <pre> below — keeps figlet's exact cell
// metrics regardless of which monospaced font Tailwind picks. Don't reformat;
// trailing spaces matter.
const NEMOCOGNITION_BANNER = ` _   _                       ____                  _ _   _             
| \\ | | ___ _ __ ___   ___  / ___|___   __ _ _ __ (_) |_(_) ___  _ __  
|  \\| |/ _ \\ '_ \` _ \\ / _ \\| |   / _ \\ / _\` | '_ \\| | __| |/ _ \\| '_ \\ 
| |\\  |  __/ | | | | | (_) | |__| (_) | (_| | | | | | |_| | (_) | | | |
|_| \\_|\\___|_| |_| |_|\\___/ \\____\\___/ \\__, |_| |_|_|\\__|_|\\___/|_| |_|
                                       |___/                           `;

const WELCOME: { type: TerminalLine["type"]; text: string }[] = [
  { type: "system", text: "  Commands" },
  { type: "system", text: "    - nemocog run <task>     Start a new NemoCognition session" },
  { type: "system", text: "    - nemocog list           Show all sessions" },
  { type: "system", text: "    - nemocog replay <id>    Open replay player for a session" },
  { type: "system", text: "    - nemocog demo           Load demo session with policy failure" },
  { type: "system", text: "    - help                   Show this message" },
  { type: "system", text: "    - clear                  Clear terminal" },
  { type: "system", text: "" },
];

export function Terminal() {
  const [lines, setLines] = useState<TerminalLine[]>(() =>
    WELCOME.map((l, i) => ({ id: i, type: l.type, text: l.text }))
  );
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const addLines = useCallback((newLines: { type: TerminalLine["type"]; text: string }[]) => {
    setLines((prev) => {
      let id = prev.length;
      return [...prev, ...newLines.map((l) => ({ ...l, id: id++ }))];
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const handleCommand = useCallback(
    async (cmd: string) => {
      addLines([{ type: "input", text: `$ ${cmd}` }]);

      const parts = cmd.trim().split(/\s+/);
      const command = parts[0]?.toLowerCase();

      if (command === "clear") {
        setLines([]);
        return;
      }

      if (command === "help") {
        addLines(WELCOME);
        return;
      }

      if (command === "nemocog" || command === "nemoclaw" /* legacy alias */) {
        const sub = parts[1]?.toLowerCase();

        if (sub === "demo") {
          addLines([
            { type: "system", text: "Loading demo session..." },
            { type: "system", text: "  Run ID: run_demo_001" },
            { type: "system", text: "  Task: Create research report from allowed documents" },
            { type: "system", text: "  Status: completed (with recovery)" },
            { type: "system", text: "" },
            { type: "system", text: "Redirecting to replay player..." },
          ]);
          setTimeout(() => router.push("/runs/run_demo_001"), 1000);
          return;
        }

        if (sub === "list") {
          router.push("/runs");
          return;
        }

        if (sub === "replay" && parts[2]) {
          addLines([
            { type: "system", text: `Opening replay for ${parts[2]}...` },
          ]);
          setTimeout(() => router.push(`/runs/${parts[2]}`), 500);
          return;
        }

        if (sub === "run" && parts.slice(2).length > 0) {
          const task = parts.slice(2).join(" ");
          addLines([
            { type: "system", text: `Starting NemoCognition session...` },
            { type: "system", text: `  Task: ${task}` },
            { type: "system", text: `  Environment: NVIDIA Brev` },
            { type: "system", text: `  Model: NVIDIA Nemotron via NIM` },
            { type: "system", text: `  Tracing: OpenInference → Phoenix` },
            { type: "system", text: `  (server runs a scripted demo flow using your task as context)` },
            { type: "system", text: "" },
          ]);

          let res: Response;
          try {
            res = await fetch("/api/sessions/start", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: task.slice(0, 60), userTask: task }),
            });
          } catch (e) {
            addLines([{ type: "error", text: `Network error: ${e}` }]);
            return;
          }
          const data = await res.json();
          if (!res.ok) {
            const msg = data?.error ? JSON.stringify(data.error) : "request failed";
            addLines([{ type: "error", text: `Error (${res.status}): ${msg}` }]);
            return;
          }

          addLines([
            { type: "system", text: `  Run ID:    ${data.runId}` },
            { type: "system", text: `  Branch:    ${data.branchId}` },
            { type: "system", text: "" },
            { type: "system", text: "● Streaming events..." },
          ]);

          await new Promise<void>((resolve) => {
            const es = new EventSource(data.sseUrl);
            es.onmessage = (msg) => {
              try {
                const wrapped = JSON.parse(msg.data) as {
                  seq: number;
                  event: { type: string; [k: string]: unknown };
                };
                const ev = wrapped.event;

                if (ev.type === "complete") {
                  addLines([
                    { type: "system", text: "" },
                    { type: "system", text: `✓ Session ended (status: ${(ev as { status?: string }).status ?? "unknown"})` },
                    { type: "system", text: "Opening replay player..." },
                  ]);
                  es.close();
                  setTimeout(() => router.push(`/runs/${data.runId}`), 800);
                  resolve();
                  return;
                }

                if (ev.type === "error") {
                  addLines([{ type: "error", text: `  ✗ error: ${(ev as { message?: string }).message ?? ""}` }]);
                  return;
                }

                const label = formatEventLabel(ev);
                if (label) addLines([{ type: "output", text: `  → ${label}` }]);
              } catch (e) {
                addLines([{ type: "error", text: `  stream parse error: ${e}` }]);
              }
            };
            es.onerror = () => {
              addLines([{ type: "error", text: "  stream disconnected" }]);
              es.close();
              resolve();
            };
          });
          return;
        }

        addLines([{ type: "error", text: "Usage: nemocog <run|list|replay|demo> [args]" }]);
        return;
      }

      addLines([{ type: "error", text: `Unknown command: ${command}. Type 'help' for available commands.` }]);
    },
    [addLines, router]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    handleCommand(input.trim());
    setInput("");
  };

  return (
    <div
      className="flex flex-col h-screen cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      <div className="flex items-center justify-between px-8 py-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-[var(--color-text)]">NemoCognition</span>
          <span className="h-3 w-px bg-[var(--color-border-strong)]" />
          <span className="text-xs text-[var(--color-text-muted)]">Terminal</span>
        </div>
        <Link
          href="/runs"
          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          Sessions →
        </Link>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden px-8 py-6">
      <div className="flex-1 overflow-y-auto font-mono text-[13px] leading-relaxed">
          {/* NemoCognition figlet banner — NVIDIA green wordmark with a
           * soft phosphor halo. The single bright accent on the page. */}
          <pre
            aria-label="NemoCognition"
            className="text-[var(--color-accent)] mb-6 select-none"
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, \"Liberation Mono\", monospace",
              fontSize: "12px",
              lineHeight: 1,
              textShadow:
                "0 0 12px rgba(118, 185, 0, 0.35), 0 0 2px rgba(148, 214, 0, 0.6)",
            }}
          >
            {NEMOCOGNITION_BANNER}
          </pre>
        {lines.map((line) => (
          <div
            key={line.id}
            className={
              line.type === "input"
                ? "text-[var(--color-text)]"
                : line.type === "error"
                ? "text-[var(--color-failure)]"
                : line.type === "system"
                ? "text-[var(--color-text-muted)]"
                : "text-[var(--color-text)]"
            }
          >
            {line.text || " "}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={handleSubmit} className="flex items-center gap-2 pt-3 mt-3 border-t border-[var(--color-border)]">
        <span className="text-[var(--color-success)] font-mono text-[13px]">›</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 bg-transparent text-[var(--color-text)] font-mono text-[13px] outline-none placeholder:text-[var(--color-text-subtle)]"
          placeholder="nemocog run <task>  ·  type 'help' for commands"
          autoFocus
        />
      </form>
      </div>
    </div>
  );
}
