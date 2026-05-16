"use client";

import Link from "next/link";
import type { Run } from "@nemocognition/core";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  running: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  completed: "bg-green-500/20 text-green-400 border-green-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
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
  return (
    <Link href={`/runs/${run.id}`} className="block group">
      <div className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:border-[var(--color-accent)]/40 transition-all duration-200">
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-medium text-[var(--color-text)] group-hover:text-[var(--color-accent)] transition-colors truncate mr-3">
            {run.title}
          </h3>
          <span
            className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_COLORS[run.status] ?? ""}`}
          >
            {run.status}
          </span>
        </div>
        <p className="text-xs text-[var(--color-text-muted)] line-clamp-2 mb-3">
          {run.userTask}
        </p>
        <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)]">
          <span className="font-mono">{run.id}</span>
          <span>{timeAgo(run.createdAt)}</span>
        </div>
      </div>
    </Link>
  );
}
