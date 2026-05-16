"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { RestoreConfirmModal } from "./RestoreConfirmModal";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  { ssr: false },
);

interface FileEntry {
  path: string;
  size: number;
}

interface TreeResponse {
  cpId: string;
  runId: string;
  branchId: string;
  nodeId: string;
  kind: string;
  checksum: string;
  fileCount: number;
  files: FileEntry[];
  sandboxRoot: string;
  createdAt: string;
}

interface FileResponse {
  path: string;
  bytes: number;
  truncated: boolean;
  content: string;
}

interface CodebaseTabProps {
  checkpointId: string;
}

interface DirNode {
  type: "dir";
  name: string;
  path: string;
  children: TreeNode[];
}
interface FileNode {
  type: "file";
  name: string;
  path: string;
  size: number;
}
type TreeNode = DirNode | FileNode;

function buildTree(files: FileEntry[]): DirNode {
  const root: DirNode = { type: "dir", name: "/", path: "", children: [] };
  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let cursor: DirNode = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      let next = cursor.children.find(
        (c): c is DirNode => c.type === "dir" && c.name === seg,
      );
      if (!next) {
        next = {
          type: "dir",
          name: seg,
          path: parts.slice(0, i + 1).join("/"),
          children: [],
        };
        cursor.children.push(next);
      }
      cursor = next;
    }
    cursor.children.push({
      type: "file",
      name: parts[parts.length - 1],
      path: f.path,
      size: f.size,
    });
  }
  // Sort: dirs first, then alpha.
  function sort(d: DirNode): void {
    d.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const c of d.children) if (c.type === "dir") sort(c);
  }
  sort(root);
  return root;
}

function languageFromPath(p: string): string {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    json: "json",
    md: "markdown",
    yml: "yaml",
    yaml: "yaml",
    css: "css",
    html: "html",
    sh: "shell",
    txt: "plaintext",
  };
  return map[ext] ?? "plaintext";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (p: string) => void;
  expanded: Set<string>;
  toggleDir: (p: string) => void;
}

function TreeRow({ node, depth, selectedPath, onSelectFile, expanded, toggleDir }: TreeRowProps) {
  const indent = { paddingLeft: `${depth * 12 + 8}px` };
  if (node.type === "dir") {
    const open = expanded.has(node.path);
    return (
      <>
        <button
          type="button"
          onClick={() => toggleDir(node.path)}
          className="w-full text-left text-xs py-1 hover:bg-[var(--color-bg)]/40 flex items-center gap-1 text-[var(--color-text)]"
          style={indent}
        >
          <span className="text-[var(--color-text-muted)] w-3">{open ? "▾" : "▸"}</span>
          <span className="truncate">{node.name || "/"}</span>
        </button>
        {open && node.children.map((c) => (
          <TreeRow
            key={c.path}
            node={c}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
            expanded={expanded}
            toggleDir={toggleDir}
          />
        ))}
      </>
    );
  }
  const selected = node.path === selectedPath;
  return (
    <button
      type="button"
      onClick={() => onSelectFile(node.path)}
      className={`w-full text-left text-xs py-1 flex items-center gap-1 transition-colors ${
        selected
          ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
          : "text-[var(--color-text)] hover:bg-[var(--color-bg)]/40"
      }`}
      style={indent}
    >
      <span className="text-[var(--color-text-muted)] w-3">·</span>
      <span className="truncate flex-1">{node.name}</span>
      <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
        {formatBytes(node.size)}
      </span>
    </button>
  );
}

export function CodebaseTab({ checkpointId }: CodebaseTabProps) {
  const [tree, setTree] = useState<TreeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileResponse | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [showRestore, setShowRestore] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setTree(null);
    setError(null);
    setSelectedPath(null);
    setFileContent(null);
    fetch(`/api/checkpoints/${checkpointId}/tree`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<TreeResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        setTree(data);
        if (data.files.length > 0) setSelectedPath(data.files[0].path);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [checkpointId, refreshTick]);

  useEffect(() => {
    if (!selectedPath) return;
    let cancelled = false;
    setFileLoading(true);
    setFileContent(null);
    fetch(
      `/api/checkpoints/${checkpointId}/file?path=${encodeURIComponent(selectedPath)}`,
    )
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<FileResponse>;
      })
      .then((data) => {
        if (!cancelled) setFileContent(data);
      })
      .catch(() => {
        /* swallow — viewer will render a placeholder */
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPath, checkpointId, refreshTick]);

  const root = useMemo(() => (tree ? buildTree(tree.files) : null), [tree]);

  const toggleDir = useCallback((p: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }, []);

  const handleRestoreApplied = useCallback(() => {
    setShowRestore(false);
    setRefreshTick((t) => t + 1);
  }, []);

  if (error) {
    return (
      <div className="p-4 text-xs text-[var(--color-failure)]">
        Could not load codebase view: {error}
      </div>
    );
  }
  if (!tree) {
    return <div className="p-4 text-xs text-[var(--color-text-muted)]">Loading snapshot…</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Metadata header */}
      <div className="px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] text-[10px] text-[var(--color-text-muted)] font-mono flex items-center gap-3 flex-wrap">
        <span>{tree.fileCount} files</span>
        <span>•</span>
        <span title={tree.checksum}>sha256:{tree.checksum.slice(0, 8)}</span>
        <span>•</span>
        <span>kind: {tree.kind}</span>
        <span className="ml-auto truncate">{tree.sandboxRoot}</span>
      </div>

      {/* Tree + viewer */}
      <div className="flex-1 flex min-h-0">
        <div className="w-44 border-r border-[var(--color-border)] overflow-y-auto bg-[var(--color-bg-secondary)]">
          {root && root.children.length === 0 ? (
            <div className="p-3 text-[11px] text-[var(--color-text-muted)] italic">
              Sandbox empty at this checkpoint.
            </div>
          ) : (
            root?.children.map((c) => (
              <TreeRow
                key={c.path}
                node={c}
                depth={0}
                selectedPath={selectedPath}
                onSelectFile={setSelectedPath}
                expanded={expanded}
                toggleDir={toggleDir}
              />
            ))
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          {selectedPath ? (
            <>
              <div className="px-3 py-1.5 border-b border-[var(--color-border)] text-[10px] font-mono text-[var(--color-text-muted)] flex items-center gap-2">
                <span className="truncate flex-1">{selectedPath}</span>
                {fileContent && (
                  <span>
                    {formatBytes(fileContent.bytes)}
                    {fileContent.truncated && " (truncated)"}
                  </span>
                )}
              </div>
              <div className="flex-1 min-h-0">
                {fileLoading ? (
                  <div className="p-3 text-[11px] text-[var(--color-text-muted)]">Loading…</div>
                ) : fileContent ? (
                  <MonacoEditor
                    height="100%"
                    theme="vs-dark"
                    language={languageFromPath(selectedPath)}
                    value={fileContent.content}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      fontSize: 11,
                      lineNumbers: "on",
                      scrollBeyondLastLine: false,
                      wordWrap: "on",
                    }}
                  />
                ) : (
                  <div className="p-3 text-[11px] text-[var(--color-text-muted)]">
                    Could not load file.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-3 text-[11px] text-[var(--color-text-muted)]">
              Select a file to view its contents at this checkpoint.
            </div>
          )}
        </div>
      </div>

      {/* Restore footer */}
      <div className="px-3 py-2 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex items-center justify-between gap-2">
        <span className="text-[10px] text-[var(--color-text-muted)] truncate">
          Restoring will overwrite the live sandbox. Current state is auto-checkpointed first.
        </span>
        <button
          type="button"
          onClick={() => setShowRestore(true)}
          className="text-xs px-3 py-1.5 rounded border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 transition-colors whitespace-nowrap"
        >
          ⟲ Restore state
        </button>
      </div>

      {showRestore && (
        <RestoreConfirmModal
          checkpointId={checkpointId}
          onCancel={() => setShowRestore(false)}
          onApplied={handleRestoreApplied}
        />
      )}
    </div>
  );
}
