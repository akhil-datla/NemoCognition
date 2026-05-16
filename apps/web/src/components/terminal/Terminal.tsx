"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface TerminalLine {
  id: number;
  type: "input" | "output" | "error" | "system";
  text: string;
}

const WELCOME = [
  "╔══════════════════════════════════════════════════════════════╗",
  "║         NemoClaw Policy Replay Lab  v0.1.0                  ║",
  "║         Visual Execution • Failure • Recovery Debugger       ║",
  "╚══════════════════════════════════════════════════════════════╝",
  "",
  "  Commands:",
  "    nemoclaw run <task>    Start a new NemoClaw session",
  "    nemoclaw list          Show all sessions",
  "    nemoclaw replay <id>   Open replay player for a session",
  "    nemoclaw demo          Load demo session with policy failure",
  "    help                   Show this message",
  "    clear                  Clear terminal",
  "",
];

export function Terminal() {
  const [lines, setLines] = useState<TerminalLine[]>(() =>
    WELCOME.map((text, i) => ({ id: i, type: "system" as const, text }))
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
        addLines(WELCOME.map((text) => ({ type: "system" as const, text })));
        return;
      }

      if (command === "nemoclaw") {
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
            { type: "system", text: `Starting NemoClaw session...` },
            { type: "system", text: `  Task: ${task}` },
            { type: "system", text: `  Environment: NVIDIA Brev` },
            { type: "system", text: `  Model: NVIDIA Nemotron via NIM` },
            { type: "system", text: `  Tracing: OpenInference → Phoenix` },
          ]);

          try {
            const res = await fetch("/api/runs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: task.slice(0, 60), userTask: task }),
            });
            const data = await res.json();
            if (res.ok) {
              addLines([
                { type: "system", text: `  Run ID: ${data.id}` },
                { type: "system", text: `  Branch: ${data.rootBranchId}` },
                { type: "system", text: "" },
                { type: "system", text: "Session created. Opening replay player..." },
              ]);
              setTimeout(() => router.push(`/runs/${data.id}`), 1000);
            } else {
              addLines([{ type: "error", text: `Error: ${JSON.stringify(data.error)}` }]);
            }
          } catch (e) {
            addLines([{ type: "error", text: `Network error: ${e}` }]);
          }
          return;
        }

        addLines([{ type: "error", text: "Usage: nemoclaw <run|list|replay|demo> [args]" }]);
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
      className="flex flex-col h-screen bg-[var(--color-bg)] p-4 cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      <div className="flex-1 overflow-y-auto font-mono text-sm leading-relaxed">
        {lines.map((line) => (
          <div
            key={line.id}
            className={
              line.type === "input"
                ? "text-[var(--color-accent)]"
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
      <form onSubmit={handleSubmit} className="flex items-center gap-2 pt-2 border-t border-[var(--color-border)]">
        <span className="text-[var(--color-accent)] font-mono text-sm">$</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 bg-transparent text-[var(--color-text)] font-mono text-sm outline-none"
          placeholder="Type a command..."
          autoFocus
        />
      </form>
    </div>
  );
}
