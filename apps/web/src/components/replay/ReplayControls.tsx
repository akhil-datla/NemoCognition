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
    <div className="bg-[var(--color-bg-secondary)] border-t border-[var(--color-border)] px-4 py-3">
      {/* Progress bar */}
      <div className="mb-3 relative">
        <div className="h-1.5 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            onScrub(Math.round(pct * (nodes.length - 1)));
          }}
        >
          <div
            className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
        {/* Failure markers */}
        {nodes.map((n, i) =>
          n.status === "failure" ? (
            <div
              key={n.nodeId}
              className="absolute top-0 w-1.5 h-1.5 bg-[var(--color-failure)] rounded-full -translate-y-0 cursor-pointer"
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
              className="absolute top-0 w-1.5 h-1.5 bg-[var(--color-branch)] rounded-full -translate-y-0 cursor-pointer"
              style={{ left: `${((i + 0.5) / nodes.length) * 100}%` }}
              onClick={() => onScrub(i)}
              title={n.title}
            />
          ) : null
        )}
      </div>

      <div className="flex items-center justify-between">
        {/* Left: playback controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={onPrev}
            disabled={activeIndex <= 0}
            className="w-8 h-8 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30 transition-colors"
          >
            ⏮
          </button>
          <button
            onClick={isPlaying ? onPause : onPlay}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 transition-colors text-lg"
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button
            onClick={onNext}
            disabled={activeIndex >= nodes.length - 1}
            className="w-8 h-8 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30 transition-colors"
          >
            ⏭
          </button>
          <div className="flex items-center gap-1 ml-2">
            {[0.5, 1, 2].map((speed) => (
              <button
                key={speed}
                onClick={() => onSpeedChange(speed)}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                  playbackSpeed === speed
                    ? "bg-[var(--color-accent)]/20 text-[var(--color-accent)]"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>
        </div>

        {/* Center: current node info */}
        <div className="text-center text-xs text-[var(--color-text-muted)]">
          {activeNode ? (
            <span>
              <span className="text-[var(--color-text)]">{activeIndex + 1}</span>
              <span> / {nodes.length}</span>
              <span className="mx-2">•</span>
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
              className="text-xs px-3 py-1.5 rounded border border-[var(--color-failure)]/40 text-[var(--color-failure)] hover:bg-[var(--color-failure)]/10 transition-colors"
            >
              Jump to failure
            </button>
          )}
          <select
            value={selectedBranchId ?? "all"}
            onChange={(e) => onBranchChange(e.target.value === "all" ? null : e.target.value)}
            className="text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-[var(--color-text)] outline-none"
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
