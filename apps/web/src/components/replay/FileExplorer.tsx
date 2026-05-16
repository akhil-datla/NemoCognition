"use client";

import { useCallback, useEffect, useState } from "react";

interface FileEntry {
  name: string;
  type: "dir" | "file" | "other";
}

interface DirResponse {
  kind: "directory";
  path: string;
  entries: FileEntry[];
  total: number;
  truncated: boolean;
  root: string;
  runScoped: boolean;
}

interface FileResponse {
  kind: "file";
  path: string;
  content: string | null;
  binary: boolean;
  bytes: number;
  truncated: boolean;
  root: string;
  runScoped: boolean;
}

interface DirState {
  loading: boolean;
  entries?: FileEntry[];
  error?: string;
}

interface FileExplorerProps {
  runId?: string;
  highlightPath?: string;
}

function joinPath(parent: string, child: string): string {
  if (parent === "." || parent === "") return child;
  return `${parent}/${child}`;
}

function parentOf(p: string): string | null {
  if (p === "." || p === "") return null;
  const idx = p.lastIndexOf("/");
  return idx === -1 ? "." : p.slice(0, idx);
}

export function FileExplorer({ runId, highlightPath }: FileExplorerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["."]));
  const [dirs, setDirs] = useState<Record<string, DirState>>({});
  const [selected, setSelected] = useState<string | null>(highlightPath ?? null);
  const [fileData, setFileData] = useState<FileResponse | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [rootLabel, setRootLabel] = useState<string>("");
  const [runScoped, setRunScoped] = useState<boolean | null>(null);

  const apiUrl = useCallback(
    (p: string) => {
      const params = new URLSearchParams({ path: p });
      if (runId) params.set("runId", runId);
      return `/api/files?${params.toString()}`;
    },
    [runId],
  );

  const loadDir = useCallback(
    async (p: string) => {
      setDirs((d) => ({ ...d, [p]: { ...(d[p] ?? {}), loading: true, error: undefined } }));
      try {
        const res = await fetch(apiUrl(p));
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as DirResponse;
        setRootLabel((cur) => cur || data.root);
        setRunScoped((cur) => (cur === null ? data.runScoped : cur));
        setDirs((d) => ({ ...d, [p]: { loading: false, entries: data.entries } }));
      } catch (err) {
        setDirs((d) => ({
          ...d,
          [p]: { loading: false, error: err instanceof Error ? err.message : String(err) },
        }));
      }
    },
    [apiUrl],
  );

  const loadFile = useCallback(
    async (p: string) => {
      setFileLoading(true);
      setFileError(null);
      setFileData(null);
      try {
        const res = await fetch(apiUrl(p));
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as FileResponse;
        setFileData(data);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : String(err));
      } finally {
        setFileLoading(false);
      }
    },
    [apiUrl],
  );

  useEffect(() => {
    void loadDir(".");
  }, [loadDir]);

  // Auto-expand ancestors of highlightPath and select it.
  useEffect(() => {
    if (!highlightPath) return;
    const parts = highlightPath.split("/").filter(Boolean);
    const ancestors = new Set<string>(["."]);
    let cur = ".";
    for (let i = 0; i < parts.length - 1; i++) {
      cur = joinPath(cur === "." ? "" : cur, parts[i]);
      ancestors.add(cur);
    }
    setExpanded((e) => {
      const next = new Set(e);
      ancestors.forEach((a) => next.add(a));
      return next;
    });
    ancestors.forEach((a) => {
      if (!dirs[a]?.entries && !dirs[a]?.loading) void loadDir(a);
    });
    setSelected(highlightPath);
    void loadFile(highlightPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightPath]);

  const toggle = (p: string) => {
    setExpanded((e) => {
      const next = new Set(e);
      if (next.has(p)) {
        next.delete(p);
      } else {
        next.add(p);
        if (!dirs[p]?.entries && !dirs[p]?.loading) void loadDir(p);
      }
      return next;
    });
  };

  const openFile = (p: string) => {
    setSelected(p);
    void loadFile(p);
  };

  const renderNode = (parentPath: string, entry: FileEntry, depth: number) => {
    const full = parentPath === "." ? entry.name : `${parentPath}/${entry.name}`;
    const isDir = entry.type === "dir";
    const isOpen = expanded.has(full);
    const isSelected = selected === full;
    return (
      <div key={full}>
        <button
          onClick={() => (isDir ? toggle(full) : openFile(full))}
          className={`w-full flex items-center gap-1 px-2 py-0.5 text-left font-mono text-[11px] transition-colors ${
            isSelected
              ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
              : "text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]"
          }`}
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          <span className="text-[var(--color-text-muted)] w-3 flex-shrink-0">
            {isDir ? (isOpen ? "▾" : "▸") : entry.type === "file" ? "·" : "○"}
          </span>
          <span
            className={`truncate ${isDir ? "text-[var(--color-accent)]" : ""}`}
            title={entry.name}
          >
            {entry.name}
            {isDir ? "/" : ""}
          </span>
        </button>
        {isDir && isOpen && (
          <div>
            {dirs[full]?.loading && (
              <div
                className="text-[10px] text-[var(--color-text-muted)] py-0.5"
                style={{ paddingLeft: 8 + (depth + 1) * 12 }}
              >
                loading…
              </div>
            )}
            {dirs[full]?.error && (
              <div
                className="text-[10px] text-[var(--color-failure)] py-0.5"
                style={{ paddingLeft: 8 + (depth + 1) * 12 }}
              >
                {dirs[full].error}
              </div>
            )}
            {dirs[full]?.entries?.map((e) => renderNode(full, e, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const rootState = dirs["."];

  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      {rootLabel && (
        <div className="text-[10px] font-mono truncate flex items-center gap-2" title={rootLabel}>
          <span className="text-[var(--color-text-muted)]">root: {rootLabel}</span>
          {runId && runScoped === false && (
            <span
              className="px-1.5 py-0.5 rounded text-[9px]"
              style={{
                color: "#eab308",
                backgroundColor: "#eab30820",
                border: "1px solid #eab30840",
              }}
              title="The run's original sandbox is no longer tracked (server restart or TTL eviction). Showing the default workspace root."
            >
              fallback
            </span>
          )}
        </div>
      )}
      <div className="flex flex-col md:flex-row gap-2 flex-1 min-h-0">
        <div className="md:w-1/2 flex-shrink-0 border border-[var(--color-border)] rounded bg-[var(--color-bg)] overflow-auto max-h-[55vh]">
          {rootState?.loading && !rootState.entries && (
            <div className="p-3 text-[var(--color-text-muted)] text-[11px]">Loading…</div>
          )}
          {rootState?.error && (
            <div className="p-3 text-[var(--color-failure)] text-[11px]">{rootState.error}</div>
          )}
          {rootState?.entries?.map((e) => renderNode(".", e, 0))}
        </div>
        <div className="flex-1 min-w-0 border border-[var(--color-border)] rounded bg-[var(--color-bg)] overflow-hidden flex flex-col max-h-[55vh]">
          {selected ? (
            <>
              <div className="px-3 py-1.5 border-b border-[var(--color-border)] flex items-center justify-between gap-2">
                <code className="text-[10px] font-mono text-[var(--color-text)] truncate" title={selected}>
                  {selected}
                </code>
                {fileData && (
                  <span className="text-[10px] text-[var(--color-text-muted)] font-mono whitespace-nowrap">
                    {fileData.bytes.toLocaleString()} B
                    {fileData.truncated ? " · truncated" : ""}
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-auto">
                {fileLoading && (
                  <div className="p-3 text-[var(--color-text-muted)] text-[11px]">Loading…</div>
                )}
                {fileError && (
                  <div className="p-3 text-[var(--color-failure)] text-[11px]">{fileError}</div>
                )}
                {fileData?.binary && (
                  <div className="p-3 text-[var(--color-text-muted)] text-[11px] italic">
                    Binary file — preview unavailable.
                  </div>
                )}
                {fileData && !fileData.binary && fileData.content !== null && (
                  <pre className="p-3 text-[11px] text-[var(--color-text)] font-mono leading-relaxed whitespace-pre-wrap break-words">
                    {fileData.content || "(empty file)"}
                  </pre>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)] text-[11px]">
              Select a file to preview
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
