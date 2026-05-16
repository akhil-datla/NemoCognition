"use client";

import { useState, useEffect, useRef } from "react";
import type { ExecutionNode } from "@nemocognition/core";

interface StreamingTextProps {
  node: ExecutionNode | null;
  isPlaying: boolean;
}

export function StreamingText({ node, isPlaying }: StreamingTextProps) {
  const [displayed, setDisplayed] = useState("");
  const [charIndex, setCharIndex] = useState(0);
  const prevNodeId = useRef<string | null>(null);

  const fullText = node
    ? buildNodeNarrative(node)
    : "";

  useEffect(() => {
    if (node?.nodeId !== prevNodeId.current) {
      setDisplayed("");
      setCharIndex(0);
      prevNodeId.current = node?.nodeId ?? null;
    }
  }, [node?.nodeId]);

  useEffect(() => {
    if (!isPlaying || charIndex >= fullText.length) return;

    const speed = 15 + Math.random() * 10;
    const timer = setTimeout(() => {
      setDisplayed(fullText.slice(0, charIndex + 1));
      setCharIndex(charIndex + 1);
    }, speed);
    return () => clearTimeout(timer);
  }, [isPlaying, charIndex, fullText]);

  useEffect(() => {
    if (!isPlaying && charIndex < fullText.length && node) {
      setDisplayed(fullText);
      setCharIndex(fullText.length);
    }
  }, [isPlaying, node, charIndex, fullText]);

  if (!node) {
    return (
      <div className="p-6 text-center text-[var(--color-text-muted)] text-sm">
        Select a node or press play to begin streaming
      </div>
    );
  }

  return (
    <div className="p-4 font-mono text-sm leading-relaxed">
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[var(--color-border)]">
        <span
          className="w-2 h-2 rounded-full"
          style={{
            backgroundColor:
              node.status === "success" ? "#22c55e" :
              node.status === "failure" ? "#ef4444" :
              node.status === "memory" ? "#3b82f6" :
              node.status === "branch" ? "#a855f7" :
              "#eab308",
          }}
        />
        <span className="text-xs text-[var(--color-text-muted)]">{node.type}</span>
        <span className="text-xs text-[var(--color-text-muted)]">•</span>
        <span className="text-xs text-[var(--color-text)]">{node.title}</span>
      </div>
      <pre className="whitespace-pre-wrap text-[var(--color-text)]">
        {displayed}
        {charIndex < fullText.length && (
          <span className="animate-pulse text-[var(--color-accent)]">▊</span>
        )}
      </pre>
    </div>
  );
}

function buildNodeNarrative(node: ExecutionNode): string {
  const lines: string[] = [];

  switch (node.type) {
    case "agent_message":
      lines.push(`[Agent] ${node.summary}`);
      break;
    case "model_call":
      lines.push(`[Nemotron via NIM] Generating response...`);
      lines.push(`Provider: NVIDIA`);
      lines.push(`Model: Nemotron`);
      lines.push(``);
      lines.push(`Output: ${node.summary}`);
      break;
    case "tool_call":
      lines.push(`[Tool Call] ${node.title}`);
      lines.push(`Status: ${node.status}`);
      lines.push(``);
      lines.push(`${node.summary}`);
      break;
    case "tool_result":
      lines.push(`[Tool Result] ${node.summary}`);
      break;
    case "policy_allow":
      lines.push(`[OpenShell] ALLOWED`);
      lines.push(`${node.summary}`);
      break;
    case "policy_deny":
      lines.push(`[OpenShell] ⊘ DENIED`);
      lines.push(``);
      lines.push(`The agent attempted an unsafe action.`);
      lines.push(`NemoClaw protected the system.`);
      lines.push(``);
      lines.push(`${node.summary}`);
      if (node.checkpointId) {
        lines.push(``);
        lines.push(`Checkpoint available: ${node.checkpointId}`);
        lines.push(`Recovery is possible from this state.`);
      }
      break;
    case "memory_update":
      lines.push(`[Memory] ${node.summary}`);
      break;
    case "branch_start":
      lines.push(`[Recovery Branch] ⑂`);
      lines.push(``);
      lines.push(`${node.summary}`);
      break;
    case "human_correction":
      lines.push(`[Human Correction] ✎`);
      lines.push(``);
      lines.push(`${node.summary}`);
      break;
    case "validation":
      lines.push(`[Validation] ${node.status === "success" ? "✓ PASSED" : "✕ FAILED"}`);
      lines.push(``);
      lines.push(`${node.summary}`);
      break;
    default:
      lines.push(`[${node.type}] ${node.summary}`);
  }

  return lines.join("\n");
}
