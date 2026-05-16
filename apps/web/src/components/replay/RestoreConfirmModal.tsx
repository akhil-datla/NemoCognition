"use client";

import { useEffect, useState } from "react";

interface DiffEntry {
  path: string;
  status: "added" | "modified" | "deleted" | "unchanged";
  snapshotSize: number | null;
  currentSize: number | null;
}

interface DiffResponse {
  cpId: string;
  sandboxRoot: string;
  summary: Record<DiffEntry["status"], number>;
  entries: DiffEntry[];
}

interface RestoreResponse {
  preRestoreCheckpointId: string;
  restoredFromCheckpointId: string;
  restoredCount: number;
  sandboxRoot: string;
}

interface RestoreConfirmModalProps {
  checkpointId: string;
  onCancel: () => void;
  onApplied: (result: RestoreResponse) => void;
}

const STATUS_COLORS: Record<DiffEntry["status"], string> = {
  added: "#22c55e",
  modified: "#eab308",
  deleted: "#ef4444",
  unchanged: "#6b7280",
};

export function RestoreConfirmModal({
  checkpointId,
  onCancel,
  onApplied,
}: RestoreConfirmModalProps) {
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [result, setResult] = useState<RestoreResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/checkpoints/${checkpointId}/diff`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<DiffResponse>;
      })
      .then((d) => {
        if (!cancelled) setDiff(d);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [checkpointId]);

  const handleApply = async () => {
    setApplying(true);
    setApplyError(null);
    try {
      const r = await fetch(`/api/checkpoints/${checkpointId}/restore`, {
        method: "POST",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      const data = (await r.json()) as RestoreResponse;
      setResult(data);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  const changedEntries = diff?.entries.filter((e) => e.status !== "unchanged") ?? [];

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
      >
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-[var(--color-text)]">
              Restore sandbox to checkpoint
            </h2>
            <p className="text-[10px] text-[var(--color-text-muted)] font-mono mt-0.5">
              {checkpointId}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-lg"
          >
            ×
          </button>
        </div>

        {result ? (
          <div className="p-6 flex-1 flex flex-col items-center justify-center text-center gap-3">
            <div className="text-2xl text-[var(--color-success,#22c55e)]">✓</div>
            <p className="text-sm text-[var(--color-text)]">
              Restored {result.restoredCount} files into{" "}
              <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
                {result.sandboxRoot}
              </span>
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              The previous state was saved as{" "}
              <span className="font-mono text-[var(--color-accent)]">
                {result.preRestoreCheckpointId}
              </span>{" "}
              — you can restore back at any time.
            </p>
            <button
              type="button"
              onClick={() => onApplied(result)}
              className="mt-2 px-4 py-1.5 rounded border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 text-[var(--color-accent)] text-xs hover:bg-[var(--color-accent)]/20"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4">
              {loadError && (
                <div className="text-xs text-[var(--color-failure)]">
                  Could not compute diff: {loadError}
                </div>
              )}
              {!loadError && !diff && (
                <div className="text-xs text-[var(--color-text-muted)]">Computing diff…</div>
              )}
              {diff && (
                <>
                  <div className="flex gap-3 text-xs mb-3">
                    {(["added", "modified", "deleted"] as const).map((k) => (
                      <span
                        key={k}
                        className="px-2 py-0.5 rounded font-mono"
                        style={{
                          backgroundColor: `${STATUS_COLORS[k]}20`,
                          color: STATUS_COLORS[k],
                          border: `1px solid ${STATUS_COLORS[k]}40`,
                        }}
                      >
                        {diff.summary[k]} {k}
                      </span>
                    ))}
                    <span className="text-[var(--color-text-muted)] ml-auto">
                      {diff.summary.unchanged} unchanged
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)] font-mono mb-2 truncate">
                    {diff.sandboxRoot}
                  </div>
                  {changedEntries.length === 0 ? (
                    <div className="text-xs text-[var(--color-text-muted)] italic py-4">
                      Live sandbox already matches this checkpoint — no changes to apply.
                    </div>
                  ) : (
                    <ul className="space-y-1">
                      {changedEntries.map((e) => (
                        <li
                          key={e.path}
                          className="flex items-center gap-2 text-xs font-mono"
                        >
                          <span
                            className="w-16 text-[10px] uppercase tracking-wide"
                            style={{ color: STATUS_COLORS[e.status] }}
                          >
                            {e.status}
                          </span>
                          <span className="text-[var(--color-text)] flex-1 truncate">
                            {e.path}
                          </span>
                          <span className="text-[10px] text-[var(--color-text-muted)] tabular-nums">
                            {e.currentSize ?? "—"} → {e.snapshotSize ?? "—"} B
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              {applyError && (
                <div className="mt-3 text-xs text-[var(--color-failure)]">
                  Restore failed: {applyError}
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={applying}
                className="px-3 py-1.5 rounded text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={applying || !diff}
                className="px-4 py-1.5 rounded text-xs border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25 disabled:opacity-50"
              >
                {applying ? "Applying…" : "Apply restore"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
