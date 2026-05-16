"use client";

import { useState } from "react";
import type { ExecutionNode, PolicyDecisionEvent } from "@nemocognition/core";

type Tab = "summary" | "memory" | "prompt" | "tool_io" | "file_diff" | "policy" | "audit" | "raw";

const TABS: { id: Tab; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "memory", label: "Memory" },
  { id: "prompt", label: "Prompt" },
  { id: "tool_io", label: "Tool I/O" },
  { id: "file_diff", label: "Diff" },
  { id: "policy", label: "Policy" },
  { id: "audit", label: "Audit" },
  { id: "raw", label: "JSON" },
];

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

export function NodeInspector({ node, policyEvent, onClose }: NodeInspectorProps) {
  const [activeTab, setActiveTab] = useState<Tab>("summary");
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
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-xs whitespace-nowrap transition-colors border-b-2 ${
              activeTab === tab.id
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
        {activeTab === "summary" && (
          <div className="space-y-4">
            <div>
              <label className="text-[var(--color-text-muted)] block mb-1">Description</label>
              <p className="text-[var(--color-text)] leading-relaxed">{node.summary}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[var(--color-text-muted)] block mb-1">Started</label>
                <p className="text-[var(--color-text)] font-mono">{new Date(node.startedAt).toLocaleTimeString()}</p>
              </div>
              <div>
                <label className="text-[var(--color-text-muted)] block mb-1">Ended</label>
                <p className="text-[var(--color-text)] font-mono">
                  {node.endedAt ? new Date(node.endedAt).toLocaleTimeString() : "—"}
                </p>
              </div>
            </div>
            {node.checkpointId && (
              <div>
                <label className="text-[var(--color-text-muted)] block mb-1">Checkpoint</label>
                <p className="text-[var(--color-accent)] font-mono">{node.checkpointId}</p>
              </div>
            )}

            {/* Recovery actions for failure nodes */}
            {node.status === "failure" && (
              <div className="border border-[var(--color-failure)]/30 rounded-lg p-3 bg-[var(--color-failure)]/5">
                <h4 className="text-[var(--color-failure)] font-medium mb-2">Recovery Options</h4>
                <div className="space-y-2">
                  <button className="w-full text-left px-3 py-2 rounded border border-[var(--color-branch)]/40 bg-[var(--color-branch)]/5 text-[var(--color-branch)] hover:bg-[var(--color-branch)]/10 transition-colors">
                    ⑂ Replan within policy
                  </button>
                  <button className="w-full text-left px-3 py-2 rounded border border-[var(--color-risky)]/40 bg-[var(--color-risky)]/5 text-[var(--color-risky)] hover:bg-[var(--color-risky)]/10 transition-colors">
                    ⚙ Suggest policy change
                  </button>
                  <button className="w-full text-left px-3 py-2 rounded border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors">
                    ⊙ Rerun in stricter sandbox
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "policy" && policyEvent && (
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

        {activeTab === "policy" && !policyEvent && (
          <p className="text-[var(--color-text-muted)]">No policy decision for this node.</p>
        )}

        {activeTab === "memory" && (
          <div className="space-y-3">
            <p className="text-[var(--color-text-muted)]">Memory state at this node:</p>
            <pre className="bg-[var(--color-bg)] rounded p-3 overflow-x-auto text-[var(--color-text)] font-mono leading-relaxed">
              {JSON.stringify({ note: "Memory snapshot ref: " + (node.payloadRef ?? "inline") }, null, 2)}
            </pre>
          </div>
        )}

        {activeTab === "prompt" && (
          <div className="space-y-3">
            <p className="text-[var(--color-text-muted)]">Prompt / Context window:</p>
            <pre className="bg-[var(--color-bg)] rounded p-3 overflow-x-auto text-[var(--color-text)] font-mono leading-relaxed">
              {node.type === "model_call"
                ? JSON.stringify({ model: "nvidia/nemotron", context: node.summary }, null, 2)
                : "No prompt data for this node type."}
            </pre>
          </div>
        )}

        {activeTab === "tool_io" && (
          <div className="space-y-3">
            <div>
              <label className="text-[var(--color-text-muted)] block mb-1">Tool Input</label>
              <pre className="bg-[var(--color-bg)] rounded p-3 overflow-x-auto text-[var(--color-text)] font-mono">
                {node.type.includes("tool") ? JSON.stringify({ command: node.title }, null, 2) : "N/A"}
              </pre>
            </div>
            <div>
              <label className="text-[var(--color-text-muted)] block mb-1">Tool Output</label>
              <pre className="bg-[var(--color-bg)] rounded p-3 overflow-x-auto text-[var(--color-text)] font-mono">
                {node.payloadRef ?? "Inline: " + node.summary}
              </pre>
            </div>
          </div>
        )}

        {activeTab === "file_diff" && (
          <div className="space-y-3">
            <p className="text-[var(--color-text-muted)]">File changes at this step:</p>
            <pre className="bg-[var(--color-bg)] rounded p-3 overflow-x-auto font-mono">
              <span className="text-green-400">+ ./output/report.md (created)</span>
            </pre>
          </div>
        )}

        {activeTab === "audit" && (
          <div className="space-y-3">
            <p className="text-[var(--color-text-muted)]">Audit log entries:</p>
            <pre className="bg-[var(--color-bg)] rounded p-3 overflow-x-auto text-[var(--color-text)] font-mono leading-relaxed">
              {policyEvent
                ? JSON.stringify(
                    { ref: policyEvent.auditLogRef, action: policyEvent.actionType, decision: policyEvent.decision },
                    null,
                    2
                  )
                : "No audit entries for this node."}
            </pre>
          </div>
        )}

        {activeTab === "raw" && (
          <pre className="bg-[var(--color-bg)] rounded p-3 overflow-x-auto text-[var(--color-text)] font-mono leading-relaxed">
            {JSON.stringify(node, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
