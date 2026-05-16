"use client";

import { useState } from "react";
import Link from "next/link";
import type { Run } from "@nemocognition/core";
import { SessionCard } from "./SessionCard";

export function Dashboard({ runs }: { runs: Run[] }) {
  const [filter, setFilter] = useState<string>("all");

  const filtered =
    filter === "all" ? runs : runs.filter((r) => r.status === filter);

  const counts = {
    all: runs.length,
    running: runs.filter((r) => r.status === "running").length,
    completed: runs.filter((r) => r.status === "completed").length,
    failed: runs.filter((r) => r.status === "failed").length,
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-border)]">
        <div className="max-w-7xl mx-auto px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <Link
              href="/"
              className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              ← Back
            </Link>
            <div className="h-5 w-px bg-[var(--color-border-strong)]" />
            <div>
              <h1 className="text-[15px] font-medium text-[var(--color-text)] leading-tight">
                Sessions
              </h1>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                Policy replay debugger
              </p>
            </div>
          </div>
          <Link
            href="/"
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border-strong)] text-[var(--color-text)] hover:bg-white/5 hover:border-white/20 transition-colors"
          >
            New session
          </Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-8 py-8">
        <div className="flex gap-1 mb-8">
          {(["all", "running", "completed", "failed"] as const).map((status) => {
            const active = filter === status;
            return (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors capitalize ${
                  active
                    ? "bg-white/8 text-[var(--color-text)]"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5"
                }`}
              >
                {status}
                <span
                  className={`ml-2 ${
                    active
                      ? "text-[var(--color-text-muted)]"
                      : "text-[var(--color-text-subtle)]"
                  }`}
                >
                  {counts[status]}
                </span>
              </button>
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-sm text-[var(--color-text-muted)]">
              No sessions yet
            </p>
            <p className="text-xs text-[var(--color-text-subtle)] mt-2">
              Start a new session from the terminal
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((run) => (
              <SessionCard key={run.id} run={run} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
