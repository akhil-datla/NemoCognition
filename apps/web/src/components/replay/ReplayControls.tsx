"use client";

import type { ExecutionNode, Branch } from "@nemocognition/core";

interface ReplayControlsProps {
  nodes: ExecutionNode[];
  branches: Branch[];
  activeIndex: number;
  isPlaying: boolean;
  playbackSpeed: number;
  selectedBranchId: string | null;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onScrub: (index: number) => void;
  onSpeedChange: (speed: number) => void;
  onBranchChange: (branchId: string | null) => void;
  onJumpToFailure: () => void;
}

export function ReplayControls({
  nodes,
  branches,
  activeIndex,
  isPlaying,
  playbackSpeed,
  selectedBranchId,
  onPlay,
  onPause,
  onNext,
  onPrev,
  onScrub,
  onSpeedChange,
  onBranchChange,
  onJumpToFailure,
}: ReplayControlsProps) {
  const hasFailure = nodes.some((n) => n.status === "failure");
  const progress = nodes.length > 0 ? ((activeIndex + 1) / nodes.length) * 100 : 0;

  const activeNode = activeIndex >= 0 && activeIndex < nodes.length ? nodes[activeIndex] : null;

  return (
    <div className="border-t border-[var(--color-border)] px-6 py-3">
      {/* Progress bar */}
      <div className="mb-3 relative">
        <div
          className="h-1 bg-white/5 rounded-full overflow-hidden cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            onScrub(Math.round(pct * (nodes.length - 1)));
          }}
        >
          <div
            className="h-full bg-[var(--color-accent-muted)] rounded-full transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
        {/* Failure markers */}
        {nodes.map((n, i) =>
          n.status === "failure" ? (
            <div
              key={n.nodeId}
              className="absolute top-0 w-1 h-1 bg-[var(--color-failure)] rounded-full cursor-pointer"
              style={{ left: `${((i + 0.5) / nodes.length) * 100}%` }}
              onClick={() => onScrub(i)}
              title={n.title}
            />
          ) : null
        )}
        {/* Branch markers */}
        {nodes.map((n, i) =>
          n.type === "branch_start" ? (
            <div
              key={`br-${n.nodeId}`}
              className="absolute top-0 w-1 h-1 bg-[var(--color-branch)] rounded-full cursor-pointer"
              style={{ left: `${((i + 0.5) / nodes.length) * 100}%` }}
              onClick={() => onScrub(i)}
              title={n.title}
            />
          ) : null
        )}
      </div>

      <div className="flex items-center justify-between">
        {/* Left: playback controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={onPrev}
            disabled={activeIndex <= 0}
            className="w-8 h-8 flex items-center justify-center rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            aria-label="Previous"
          >
            ⏮
          </button>
          <button
            onClick={isPlaying ? onPause : onPlay}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-[var(--color-accent-muted)] text-black hover:bg-[var(--color-accent)] transition-colors text-xs"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button
            onClick={onNext}
            disabled={activeIndex >= nodes.length - 1}
            className="w-8 h-8 flex items-center justify-center rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            aria-label="Next"
          >
            ⏭
          </button>
          <div className="flex items-center gap-0.5 ml-3">
            {[0.5, 1, 2].map((speed) => (
              <button
                key={speed}
                onClick={() => onSpeedChange(speed)}
                className={`text-[11px] px-1.5 py-0.5 rounded transition-colors ${
                  playbackSpeed === speed
                    ? "text-[var(--color-text)] bg-white/8"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {speed}×
              </button>
            ))}
          </div>
        </div>

        {/* Center: current node info */}
        <div className="text-center text-xs text-[var(--color-text-muted)] truncate px-4">
          {activeNode ? (
            <span>
              <span className="text-[var(--color-text)] font-mono">{activeIndex + 1}</span>
              <span className="text-[var(--color-text-subtle)] font-mono"> / {nodes.length}</span>
              <span className="mx-2 text-[var(--color-text-subtle)]">·</span>
              <span className="text-[var(--color-text)]">{activeNode.title}</span>
            </span>
          ) : (
            <span>Press play to begin</span>
          )}
        </div>

        {/* Right: branch selector + jump to failure */}
        <div className="flex items-center gap-2">
          {hasFailure && (
            <button
              onClick={onJumpToFailure}
              className="text-xs px-3 py-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-failure)] hover:bg-white/5 transition-colors"
            >
              Jump to failure
            </button>
          )}
          <select
            value={selectedBranchId ?? "all"}
            onChange={(e) => onBranchChange(e.target.value === "all" ? null : e.target.value)}
            className="text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-md px-2 py-1.5 text-[var(--color-text)] outline-none hover:border-[var(--color-border-strong)] transition-colors"
          >
            <option value="all">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.id.replace("branch_", "")}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
