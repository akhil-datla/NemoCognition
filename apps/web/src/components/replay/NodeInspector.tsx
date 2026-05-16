"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ExecutionNode, PolicyDecisionEvent } from "@nemocognition/core";
import { CodebaseTab } from "./CodebaseTab";

type Tab = "summary" | "prompt" | "response" | "tool_io" | "policy" | "audit" | "codebase" | "raw";

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
  onClose: () => void;
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

export function NodeInspector({ node, policyEvent, onClose }: NodeInspectorProps) {
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
      {effectiveTab === "codebase" && node.checkpointId ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <CodebaseTab checkpointId={node.checkpointId} />
        </div>
      ) : (
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
              <RecoveryPanel runId={node.runId} failedNodeId={node.nodeId} />
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
      )}
    </div>
  );
}

interface RecoveryPanelProps {
  runId: string;
  failedNodeId: string;
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
function RecoveryPanel({ runId, failedNodeId }: RecoveryPanelProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecoveryResponse | null>(null);

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
      // Pull the freshly-inserted recovery branch into the graph immediately,
      // then keep refreshing for ~30s to surface nodes as they're written.
      router.refresh();
      let ticks = 0;
      const interval = setInterval(() => {
        ticks += 1;
        router.refresh();
        if (ticks >= 10) clearInterval(interval);
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="border border-[var(--color-branch)]/40 rounded-lg p-3 bg-[var(--color-branch)]/5 space-y-2">
        <h4 className="text-[var(--color-branch)] font-medium text-xs">
          Recovery branch started
        </h4>
        <p className="text-[10px] text-[var(--color-text-muted)] font-mono break-all">
          {result.branchId}
        </p>
        {result.restoredCheckpointId && (
          <p className="text-[10px] text-[var(--color-text-muted)]">
            Sandbox restored to{" "}
            <span className="font-mono text-[var(--color-accent)]">
              {result.restoredCheckpointId}
            </span>
          </p>
        )}
        <p className="text-[10px] text-[var(--color-text-muted)] italic">
          Watching for new nodes — they&apos;ll appear in the graph as the agent runs.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-[var(--color-failure)]/30 rounded-lg p-3 bg-[var(--color-failure)]/5 space-y-2">
      <h4 className="text-[var(--color-failure)] font-medium text-xs">Recovery</h4>
      <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed">
        Restores the sandbox to the checkpoint just before this failure and
        starts a new branch in this run with full failure context. The agent
        will reason fresh from the restored state.
      </p>
      <button
        type="button"
        onClick={handleClick}
        disabled={submitting}
        className="w-full text-left px-3 py-2 rounded border border-[var(--color-branch)]/40 bg-[var(--color-branch)]/5 text-[var(--color-branch)] hover:bg-[var(--color-branch)]/10 transition-colors text-xs disabled:opacity-50"
      >
        {submitting ? "Starting recovery branch…" : "⑂ Create recovery chain"}
      </button>
      {error && (
        <p className="text-[10px] text-[var(--color-failure)]">Failed: {error}</p>
      )}
    </div>
  );
}
