"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { ExecutionNode, PolicyDecisionEvent } from "@nemocognition/core";
import { CodebaseTab } from "./CodebaseTab";

type Tab = "summary" | "prompt" | "response" | "tool_io" | "policy" | "audit" | "codebase" | "raw";

// Graphite palette — mirrors globals.css + ReplayGraph.STATUS_COLORS.
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  success: { label: "Allowed / Success", color: "#76b900" },
  failure: { label: "Denied / Failure", color: "#f87171" },
  risky: { label: "Risky / Misconfigured", color: "#f59e0b" },
  memory: { label: "State Update", color: "#64a6ff" },
  branch: { label: "Recovery Branch", color: "#a78bfa" },
};

interface NodeInspectorProps {
  node: ExecutionNode;
  policyEvent?: PolicyDecisionEvent | null;
  onClose: () => void;
  /** Called when a recovery branch is created; parent should clear branch filter so the new lane is visible. */
  onRecoveryStarted?: (newBranchId: string) => void;
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

export function NodeInspector({ node, policyEvent, onClose, onRecoveryStarted }: NodeInspectorProps) {
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

  const tabs = useMemo<{ id: Tab; label: string }[]>(() => {
    const out: { id: Tab; label: string }[] = [{ id: "summary", label: "Summary" }];
    if (isModelCall && messages?.length) out.push({ id: "prompt", label: "Prompt" });
    if (isModelCall && outputMessage) out.push({ id: "response", label: "Response" });
    if (isToolCall) out.push({ id: "tool_io", label: "Tool I/O" });
    if (policyEvent) out.push({ id: "policy", label: "Policy" });
    if (policyEvent) out.push({ id: "audit", label: "Audit" });
    if (node.checkpointId) out.push({ id: "codebase", label: "Codebase" });
    out.push({ id: "raw", label: "JSON" });
    return out;
  }, [isModelCall, isToolCall, messages, outputMessage, policyEvent, node.checkpointId]);

  const [activeTab, setActiveTab] = useState<Tab>(tabs[0].id);
  const effectiveTab = tabs.find((t) => t.id === activeTab) ? activeTab : tabs[0].id;

  const statusInfo = STATUS_LABELS[node.status] ?? { label: node.status, color: "#888" };

  // Only failure / branch statuses carry a colored chip — everything else
  // gets a tiny dot so the header reads as info, not warning.
  const showColoredChip =
    node.status === "failure" || node.status === "branch";

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg-secondary)] border-l border-[var(--color-border)]">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[var(--color-border)]">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="text-[15px] font-medium text-[var(--color-text)] leading-tight truncate">
            {node.title}
          </h3>
          <button
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-lg leading-none shrink-0"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="flex items-center gap-2 mb-3">
          {showColoredChip ? (
            <span
              className="text-[11px] px-2 py-0.5 rounded-md"
              style={{
                backgroundColor: `${statusInfo.color}1a`,
                color: statusInfo.color,
              }}
            >
              {statusInfo.label}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: statusInfo.color }}
              />
              {statusInfo.label}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-subtle)] font-mono">
          <span>{node.nodeId}</span>
          <span>{node.type}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--color-border)] px-3 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2.5 text-xs whitespace-nowrap transition-colors border-b ${
              effectiveTab === tab.id
                ? "border-[var(--color-accent)] text-[var(--color-text)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {effectiveTab === "codebase" && node.checkpointId ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <CodebaseTab checkpointId={node.checkpointId} />
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto p-5 text-xs">
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
              <RecoveryPanel
                key={node.nodeId}
                runId={node.runId}
                failedNodeId={node.nodeId}
                onRecoveryStarted={onRecoveryStarted}
              />
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

        {effectiveTab === "policy" && policyEvent && (
          <div className="space-y-4">
            <div>
              <label className="text-[var(--color-text-muted)] block mb-1">Decision</label>
              <span
                className="text-sm font-medium"
                style={{
                  color:
                    policyEvent.decision === "deny"
                      ? "var(--color-failure)"
                      : "var(--color-success)",
                }}
              >
                {policyEvent.decision}
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
      )}
    </div>
  );
}

interface RecoveryPanelProps {
  runId: string;
  failedNodeId: string;
  onRecoveryStarted?: (newBranchId: string) => void;
}

interface RecoveryResponse {
  runId: string;
  branchId: string;
  forkNodeId: string;
  restoredCheckpointId: string | null;
  sandboxRoot: string;
}

/**
 * "Create recovery chain" — restores the sandbox to the pre-failure
 * checkpoint and spawns a new branch in the SAME run with failure context.
 * Auto-refreshes the page every 3s so the new branch's nodes appear in the
 * graph as they're persisted.
 */
function RecoveryPanel({ runId, failedNodeId, onRecoveryStarted }: RecoveryPanelProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecoveryResponse | null>(null);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Must clear so navigating away mid-refresh does not leak intervals. */
  useEffect(() => {
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, []);

  const handleClick = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/runs/${runId}/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ failedNodeId }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      const data = (await r.json()) as RecoveryResponse;
      setResult(data);
      // Clear branch filter first — recovery nodes live on branch_recovery_* and
      // are hidden while a single branch is selected, which feels like a no-op.
      onRecoveryStarted?.(data.branchId);
      // Pull the freshly-inserted recovery branch into the graph immediately,
      // then keep refreshing for ~30s to surface nodes as they're written.
      await router.refresh();
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
      let ticks = 0;
      refreshIntervalRef.current = setInterval(() => {
        ticks += 1;
        void router.refresh();
        if (ticks >= 10) {
          if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
          refreshIntervalRef.current = null;
        }
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-4 space-y-2 mt-2">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-branch)]" />
          <h4 className="text-xs font-medium text-[var(--color-text)]">
            Recovery branch started
          </h4>
        </div>
        <p className="text-[11px] text-[var(--color-text-muted)] font-mono break-all">
          {result.branchId}
        </p>
        {result.restoredCheckpointId && (
          <p className="text-[11px] text-[var(--color-text-muted)]">
            Sandbox restored to{" "}
            <span className="font-mono text-[var(--color-text)]">
              {result.restoredCheckpointId}
            </span>
          </p>
        )}
        <p className="text-[11px] text-[var(--color-text-subtle)]">
          Branch filter was reset to show all branches so the new lane is visible. New nodes appear as the agent runs.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-4 space-y-3 mt-2">
      <div>
        <h4 className="text-xs font-medium text-[var(--color-text)] mb-1.5">
          Recovery
        </h4>
        <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
          Restores the sandbox to the checkpoint just before this failure and
          starts a new branch in this run with full failure context.
        </p>
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={submitting}
        className="w-full px-3 py-2 rounded-md bg-[var(--color-accent)] text-black text-xs font-medium hover:bg-[var(--color-accent-bright)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? "Starting recovery branch…" : "Create recovery chain"}
      </button>
      {error && (
        <p className="text-[11px] text-[var(--color-failure)]">Failed: {error}</p>
      )}
    </div>
  );
}
