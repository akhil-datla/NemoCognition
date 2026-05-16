"use client";

import { useState } from "react";
import Link from "next/link";
import type { Run } from "@nemocognition/core";
import { SessionCard } from "./SessionCard";

export function Dashboard({ runs }: { runs: Run[] }) {
  const [filter, setFilter] = useState<string>("all");

  const filtered = filter === "all"
    ? runs
    : runs.filter((r) => r.status === filter);

  const counts = {
    all: runs.length,
    running: runs.filter((r) => r.status === "running").length,
    completed: runs.filter((r) => r.status === "completed").length,
    failed: runs.filter((r) => r.status === "failed").length,
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <header className="border-b border-[var(--color-border)] px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-[var(--color-accent)] hover:text-[var(--color-text)] transition-colors">
              <span className="font-mono text-sm">←</span>
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-[var(--color-text)]">NemoClaw Sessions</h1>
              <p className="text-xs text-[var(--color-text-muted)]">Policy replay debugger sessions</p>
            </div>
          </div>
          <Link
            href="/"
            className="text-xs px-3 py-1.5 rounded border border-[var(--color-accent)]/40 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors"
          >
            New Session
          </Link>
        </div>
      </header>

      <div className="px-6 py-4">
        <div className="flex gap-2 mb-6">
          {(["all", "running", "completed", "failed"] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filter === status
                  ? "border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10"
                  : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {status} ({counts[status]})
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-20 text-[var(--color-text-muted)]">
            <p className="text-sm">No sessions found</p>
            <p className="text-xs mt-2">Start a new session from the terminal</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((run) => (
              <SessionCard key={run.id} run={run} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
