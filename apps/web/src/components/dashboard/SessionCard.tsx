"use client";

import Link from "next/link";
import type { Run } from "@nemocognition/core";

// Status uses a single colored dot + label. The card itself stays neutral
// so it almost disappears at rest — only hovered / failed cards earn extra
// visual weight.
const STATUS: Record<
  string,
  { label: string; dot: string; muted?: boolean }
> = {
  pending: { label: "Pending", dot: "bg-[var(--color-risky)]" },
  running: { label: "Running", dot: "bg-[var(--color-success)]" },
  completed: { label: "Completed", dot: "bg-[var(--color-text-subtle)]" },
  failed: { label: "Failed", dot: "bg-[var(--color-failure)]" },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function SessionCard({ run }: { run: Run }) {
  const status = STATUS[run.status] ?? STATUS.completed;
  const isFailed = run.status === "failed";

  return (
    <Link href={`/runs/${run.id}`} className="block group">
      <div
        className={`rounded-lg p-5 transition-all duration-150 border bg-[var(--color-bg-secondary)] ${
          isFailed
            ? "border-[var(--color-failure)]/30 group-hover:border-[var(--color-failure)] group-hover:shadow-[0_0_32px_rgba(248,113,113,0.35)]"
            : "border-[var(--color-border)] group-hover:border-[var(--color-accent-bright)] group-hover:shadow-[0_0_28px_rgba(148,214,0,0.45),0_0_2px_rgba(148,214,0,0.7)]"
        } group-hover:bg-[var(--color-bg-tertiary)]`}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="text-sm font-medium text-[var(--color-text)] truncate group-hover:text-white transition-colors">
            {run.title}
          </h3>
          <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] whitespace-nowrap shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
        </div>
        <p className="text-xs text-[var(--color-text-muted)] line-clamp-2 mb-4 leading-relaxed">
          {run.userTask}
        </p>
        <div className="flex items-center justify-between text-[11px] text-[var(--color-text-subtle)]">
          <span className="font-mono truncate">{run.id}</span>
          <span className="whitespace-nowrap ml-2">{timeAgo(run.createdAt)}</span>
        </div>
      </div>
    </Link>
  );
}
