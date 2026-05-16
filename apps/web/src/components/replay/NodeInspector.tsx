"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ExecutionNode, PolicyDecisionEvent } from "@nemocognition/core";
import { FileExplorer } from "./FileExplorer";

type Tab = "summary" | "prompt" | "response" | "tool_io" | "files" | "policy" | "audit" | "raw";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  success: { label: "Allowed / Success", color: "#22c55e" },
  failure: { label: "Denied / Failure", color: "#ef4444" },
  risky: { label: "Risky / Misconfigured", color: "#eab308" },
  memory: { label: "State Update", color: "#3b82f6" },
  branch: { label: "Recovery Branch", color: "#a855f7" },
};

interface NodeInspectorProps {
  node: ExecutionNode;
  policyEvent?: PolicyDecisionEvent | null;
  runId?: string;
  onClose: () => void;
}

interface RecoveryState {
  pending: boolean;
  error: string | null;
  info: string | null;
}

interface RecoverResult {
  newBranchId?: string;
  restored?: boolean;
  checkpointId?: string;
  filesRestored?: number;
  filesRemoved?: number;
  error?: string;
}

async function recoverBranch(
  runId: string,
  failedNodeId: string,
  branchId: string,
): Promise<RecoverResult> {
  const res = await fetch(`/api/runs/${runId}/recover-branch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ failedNodeId, branchId }),
  });
  const json = (await res.json().catch(() => ({}))) as RecoverResult;
  if (!res.ok) {
    const errMsg = typeof json.error === "string" ? json.error : `API ${res.status}`;
    return { error: errMsg };
  }
  return json;
}


interface ChatMessage {
  role: string;
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: unknown[];
}

function asMessages(v: unknown): ChatMessage[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((m): m is ChatMessage => !!m && typeof m === "object" && "role" in m);
}

function pretty(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

type FileOp = "read" | "write" | "list";

interface DirEntry {
  name: string;
  type: "dir" | "file" | "other";
}

interface FileActivity {
  op: FileOp;
  path: string;
  content?: string;
  bytes?: number;
  truncated?: boolean;
  entries?: DirEntry[];
  total?: number;
}

function extractFileActivity(
  toolName: string | undefined,
  args: unknown,
  output: unknown,
): FileActivity | null {
  if (!toolName) return null;
  const a = (args && typeof args === "object" ? (args as Record<string, unknown>) : {}) ?? {};
  const o = (output && typeof output === "object" ? (output as Record<string, unknown>) : {}) ?? {};
  const argPath = typeof a.path === "string" ? a.path : undefined;
  const outPath = typeof o.path === "string" ? o.path : undefined;
  const path = outPath ?? argPath;
  if (!path) return null;

  if (toolName === "read_file") {
    return {
      op: "read",
      path,
      content: typeof o.content === "string" ? o.content : undefined,
      bytes: typeof o.bytes === "number" ? o.bytes : undefined,
      truncated: typeof o.truncated === "boolean" ? o.truncated : undefined,
    };
  }
  if (toolName === "write_file") {
    return {
      op: "write",
      path,
      content: typeof a.content === "string" ? a.content : undefined,
      bytes: typeof o.bytes === "number" ? o.bytes : undefined,
    };
  }
  if (toolName === "list_directory") {
    const rawEntries = Array.isArray(o.entries) ? o.entries : [];
    const entries: DirEntry[] = rawEntries
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map<DirEntry>((e) => {
        const t: DirEntry["type"] = e.type === "dir" || e.type === "file" ? e.type : "other";
        return { name: typeof e.name === "string" ? e.name : "", type: t };
      })
      .filter((e) => e.name);
    return {
      op: "list",
      path,
      entries,
      total: typeof o.total === "number" ? o.total : undefined,
      truncated: typeof o.truncated === "boolean" ? o.truncated : undefined,
    };
  }
  return null;
}


export function NodeInspector({ node, policyEvent, runId, onClose }: NodeInspectorProps) {
  const router = useRouter();
  const [recovery, setRecovery] = useState<RecoveryState>({
    pending: false,
    error: null,
    info: null,
  });

  const handleRestore = async () => {
    if (!runId) return;
    setRecovery({ pending: true, error: null, info: "Restoring filesystem & forking new branch…" });
    const result = await recoverBranch(runId, node.nodeId, node.branchId);
    if (result.error) {
      setRecovery({
        pending: false,
        error: result.error,
        info: null,
      });
      return;
    }
    setRecovery({
      pending: false,
      error: null,
      info:
        `Restored from checkpoint ${result.checkpointId}: ${result.filesRestored} files restored, ${result.filesRemoved} removed. ` +
        `Agent running on new branch ${result.newBranchId}.`,
    });
    // Re-render the page with the new branch's data once the agent loop finishes.
    // The page is server-rendered; refresh pulls latest nodes + branches from the store.
    setTimeout(() => router.refresh(), 1500);
  };

  const payload = (node.payload ?? {}) as Record<string, unknown>;

  const isModelCall = node.type === "model_call";
  const isToolCall = node.type === "tool_call" || node.type === "tool_result";
  const messages = isModelCall ? asMessages(payload.messages) : null;
  const outputMessage = isModelCall ? (payload.outputMessage as ChatMessage | null) : null;
  const tokenCount = isModelCall ? (payload.tokenCount as { input?: number; output?: number } | null) : null;
  const latencyMs = isModelCall ? (payload.latencyMs as number | null) : null;

  const toolArgs = isToolCall ? payload.args : undefined;
  const toolOutput = isToolCall ? payload.output : undefined;
  const toolName = isToolCall ? (payload.toolName as string | undefined) : undefined;

  const fileActivity = useMemo(() => extractFileActivity(toolName, toolArgs, toolOutput), [
    toolName,
    toolArgs,
    toolOutput,
  ]);

  const tabs = useMemo<{ id: Tab; label: string }[]>(() => {
    const out: { id: Tab; label: string }[] = [{ id: "summary", label: "Summary" }];
    if (isModelCall && messages?.length) out.push({ id: "prompt", label: "Prompt" });
    if (isModelCall && outputMessage) out.push({ id: "response", label: "Response" });
    if (isToolCall) out.push({ id: "tool_io", label: "Tool I/O" });
    out.push({ id: "files", label: "Files" });
    if (policyEvent) out.push({ id: "policy", label: "Policy" });
    if (policyEvent) out.push({ id: "audit", label: "Audit" });
    out.push({ id: "raw", label: "JSON" });
    return out;
  }, [isModelCall, isToolCall, messages, outputMessage, policyEvent]);

  const [activeTab, setActiveTab] = useState<Tab>(tabs[0].id);
  const effectiveTab = tabs.find((t) => t.id === activeTab) ? activeTab : tabs[0].id;

  const statusInfo = STATUS_LABELS[node.status] ?? { label: node.status, color: "#888" };

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg-secondary)] border-l border-[var(--color-border)]">
      {/* Header */}
      <div className="p-4 border-b border-[var(--color-border)]">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-[var(--color-text)] truncate">
              {node.title}
            </h3>
            <span
              className="inline-block text-xs px-2 py-0.5 rounded-full mt-1"
              style={{
                backgroundColor: `${statusInfo.color}20`,
                color: statusInfo.color,
                border: `1px solid ${statusInfo.color}40`,
              }}
            >
              {statusInfo.label}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] ml-2 text-lg"
          >
            ×
          </button>
        </div>
        <div className="flex gap-3 text-[10px] text-[var(--color-text-muted)] font-mono mt-2">
          <span>{node.nodeId}</span>
          <span>•</span>
          <span>{node.branchId}</span>
          <span>•</span>
          <span>{node.type}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--color-border)] px-2 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-xs whitespace-nowrap transition-colors border-b-2 ${
              effectiveTab === tab.id
                ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 text-xs">
        {effectiveTab === "summary" && (
          <div className="space-y-4">
            <div>
              <label className="text-[var(--color-text-muted)] block mb-1">Description</label>
              <p className="text-[var(--color-text)] leading-relaxed">{node.summary}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[var(--color-text-muted)] block mb-1">Started</label>
                <p className="text-[var(--color-text)] font-mono">
                  {new Date(node.startedAt).toLocaleTimeString()}
                </p>
              </div>
              <div>
                <label className="text-[var(--color-text-muted)] block mb-1">Ended</label>
                <p className="text-[var(--color-text)] font-mono">
                  {node.endedAt ? new Date(node.endedAt).toLocaleTimeString() : "—"}
                </p>
              </div>
            </div>
            {isModelCall && (tokenCount || latencyMs !== null) && (
              <div className="grid grid-cols-2 gap-3">
                {tokenCount && (
                  <div>
                    <label className="text-[var(--color-text-muted)] block mb-1">Tokens</label>
                    <p className="text-[var(--color-text)] font-mono">
                      {tokenCount.input ?? "?"} → {tokenCount.output ?? "?"}
                    </p>
                  </div>
                )}
                {latencyMs !== null && (
                  <div>
                    <label className="text-[var(--color-text-muted)] block mb-1">Latency</label>
                    <p className="text-[var(--color-text)] font-mono">{latencyMs}ms</p>
                  </div>
                )}
              </div>
            )}
            {node.checkpointId && (
              <div>
                <label className="text-[var(--color-text-muted)] block mb-1">Checkpoint</label>
                <p className="text-[var(--color-accent)] font-mono">{node.checkpointId}</p>
              </div>
            )}

            {node.status === "failure" && (
              <div className="border border-[var(--color-failure)]/30 rounded-lg p-3 bg-[var(--color-failure)]/5">
                <h4 className="text-[var(--color-failure)] font-medium mb-2">Recovery</h4>
                <button
                  onClick={handleRestore}
                  disabled={!runId || recovery.pending}
                  className="w-full text-left px-3 py-2 rounded border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {recovery.pending ? "Restoring…" : "↺ Restore to previous checkpoint"}
                </button>
                {recovery.info && (
                  <p className="mt-2 text-[10px] text-[var(--color-text-muted)] font-mono break-words">
                    {recovery.info}
                  </p>
                )}
                {recovery.error && (
                  <p className="mt-2 text-[10px] text-[var(--color-failure)] font-mono break-words">
                    {recovery.error}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {effectiveTab === "prompt" && messages && (
          <div className="space-y-3">
            {messages.map((m, i) => (
              <div key={i} className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] mb-1">
                  {m.role}
                </div>
                {m.content && (
                  <pre className="whitespace-pre-wrap break-words text-[var(--color-text)] font-mono leading-relaxed">
                    {m.content}
                  </pre>
                )}
                {m.tool_calls && m.tool_calls.length > 0 && (
                  <pre className="mt-2 text-[var(--color-accent)] font-mono text-[10px] whitespace-pre-wrap break-words">
                    {pretty(m.tool_calls)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}

        {effectiveTab === "response" && outputMessage && (
          <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] mb-1">
              {outputMessage.role}
            </div>
            <pre className="whitespace-pre-wrap break-words text-[var(--color-text)] font-mono leading-relaxed">
              {outputMessage.content ?? pretty(outputMessage)}
            </pre>
          </div>
        )}

        {effectiveTab === "tool_io" && (
          <div className="space-y-3">
            {toolName && (
              <div>
                <label className="text-[var(--color-text-muted)] block mb-1">Tool</label>
                <p className="text-[var(--color-text)] font-mono">{toolName}</p>
              </div>
            )}
            <div>
              <label className="text-[var(--color-text-muted)] block mb-1">Input</label>
              <pre className="bg-[var(--color-bg)] rounded p-3 overflow-x-auto text-[var(--color-text)] font-mono whitespace-pre-wrap break-words">
                {pretty(toolArgs)}
              </pre>
            </div>
            <div>
              <label className="text-[var(--color-text-muted)] block mb-1">Output</label>
              <pre className="bg-[var(--color-bg)] rounded p-3 overflow-x-auto text-[var(--color-text)] font-mono whitespace-pre-wrap break-words">
                {pretty(toolOutput)}
              </pre>
            </div>
          </div>
        )}

        {effectiveTab === "files" && (
          <div className="h-full min-h-[50vh]">
            <FileExplorer
              runId={node.runId}
              highlightPath={
                fileActivity && fileActivity.op !== "list" ? fileActivity.path : undefined
              }
            />
          </div>
        )}

        {effectiveTab === "policy" && policyEvent && (
          <div className="space-y-4">
            <div>
              <label className="text-[var(--color-text-muted)] block mb-1">Decision</label>
              <span
                className="text-sm font-medium"
                style={{ color: policyEvent.decision === "deny" ? "#ef4444" : "#22c55e" }}
              >
                {policyEvent.decision.toUpperCase()}
              </span>
            </div>
            <div>
              <label className="text-[var(--color-text-muted)] block mb-1">Action</label>
              <p className="text-[var(--color-text)] font-mono">{policyEvent.actionType}</p>
            </div>
            <div>
              <label className="text-[var(--color-text-muted)] block mb-1">Resource</label>
              <p className="text-[var(--color-text)] font-mono">{policyEvent.resource}</p>
            </div>
            <div>
              <label className="text-[var(--color-text-muted)] block mb-1">Matched Rule</label>
              <code className="block bg-[var(--color-bg)] p-2 rounded text-[var(--color-accent)] font-mono">
                {policyEvent.policyRuleText}
              </code>
            </div>
            <div>
              <label className="text-[var(--color-text-muted)] block mb-1">Rule Path</label>
              <p className="text-[var(--color-text)] font-mono">{policyEvent.policyPath}</p>
            </div>
            <div>
              <label className="text-[var(--color-text-muted)] block mb-1">Reason</label>
              <p className="text-[var(--color-text)] leading-relaxed">{policyEvent.reason}</p>
            </div>
            <div>
              <label className="text-[var(--color-text-muted)] block mb-1">Actor</label>
              <p className="text-[var(--color-text)] font-mono">{policyEvent.actor}</p>
            </div>
          </div>
        )}

        {effectiveTab === "audit" && policyEvent && (
          <pre className="bg-[var(--color-bg)] rounded p-3 overflow-x-auto text-[var(--color-text)] font-mono leading-relaxed whitespace-pre-wrap break-words">
            {JSON.stringify(
              {
                ref: policyEvent.auditLogRef,
                action: policyEvent.actionType,
                decision: policyEvent.decision,
                timestamp: policyEvent.timestamp,
              },
              null,
              2,
            )}
          </pre>
        )}

        {effectiveTab === "raw" && (
          <pre className="bg-[var(--color-bg)] rounded p-3 overflow-x-auto text-[var(--color-text)] font-mono leading-relaxed whitespace-pre-wrap break-words">
            {JSON.stringify(node, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
