"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ExecutionNode, Branch, PolicyDecisionEvent } from "@nemocognition/core";
import Link from "next/link";
import { ReplayGraph } from "./ReplayGraph";
import { ReplayControls } from "./ReplayControls";
import { NodeInspector } from "./NodeInspector";
import { StreamingText } from "./StreamingText";

interface ReplayPlayerProps {
  runId: string;
  runTitle: string;
  nodes: ExecutionNode[];
  branches: Branch[];
  policyEvents: PolicyDecisionEvent[];
}

export function ReplayPlayer({
  runId,
  runTitle,
  nodes,
  branches,
  policyEvents,
}: ReplayPlayerProps) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredNodes = selectedBranchId
    ? nodes.filter((n) => n.branchId === selectedBranchId)
    : nodes;

  const activeNode = activeIndex >= 0 && activeIndex < filteredNodes.length
    ? filteredNodes[activeIndex]
    : null;

  const selectedNode = selectedNodeId
    ? nodes.find((n) => n.nodeId === selectedNodeId) ?? null
    : null;

  const selectedPolicyEvent = selectedNodeId
    ? policyEvents.find((p) => p.nodeId === selectedNodeId) ?? null
    : null;

  // Playback engine
  useEffect(() => {
    if (!isPlaying) {
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
      return;
    }

    if (activeIndex >= filteredNodes.length - 1) {
      setIsPlaying(false);
      return;
    }

    const nextNode = filteredNodes[activeIndex + 1];
    const isPausePoint = nextNode?.status === "failure";

    const baseDelay = 1500 / playbackSpeed;
    const delay = isPausePoint ? baseDelay * 2 : baseDelay;

    playTimerRef.current = setTimeout(() => {
      const nextIdx = activeIndex + 1;
      setActiveIndex(nextIdx);
      setSelectedNodeId(filteredNodes[nextIdx]?.nodeId ?? null);

      if (filteredNodes[nextIdx]?.status === "failure") {
        setIsPlaying(false);
      }
    }, delay);

    return () => {
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
    };
  }, [isPlaying, activeIndex, filteredNodes, playbackSpeed]);

  const handlePlay = useCallback(() => {
    if (activeIndex < 0) {
      setActiveIndex(0);
      setSelectedNodeId(filteredNodes[0]?.nodeId ?? null);
    }
    setShowOverlay(false);
    setIsPlaying(true);
  }, [activeIndex, filteredNodes]);

  const handlePause = useCallback(() => setIsPlaying(false), []);

  const handleNext = useCallback(() => {
    const next = Math.min(activeIndex + 1, filteredNodes.length - 1);
    setActiveIndex(next);
    setSelectedNodeId(filteredNodes[next]?.nodeId ?? null);
    setShowOverlay(false);
  }, [activeIndex, filteredNodes]);

  const handlePrev = useCallback(() => {
    const prev = Math.max(activeIndex - 1, 0);
    setActiveIndex(prev);
    setSelectedNodeId(filteredNodes[prev]?.nodeId ?? null);
  }, [activeIndex, filteredNodes]);

  const handleScrub = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, filteredNodes.length - 1));
      setActiveIndex(clamped);
      setSelectedNodeId(filteredNodes[clamped]?.nodeId ?? null);
      setShowOverlay(false);
    },
    [filteredNodes]
  );

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      const idx = filteredNodes.findIndex((n) => n.nodeId === nodeId);
      if (idx >= 0) {
        setActiveIndex(idx);
        setSelectedNodeId(nodeId);
        setShowOverlay(false);
      }
    },
    [filteredNodes]
  );

  const handleJumpToFailure = useCallback(() => {
    const idx = filteredNodes.findIndex((n) => n.status === "failure");
    if (idx >= 0) {
      setActiveIndex(idx);
      setSelectedNodeId(filteredNodes[idx].nodeId);
      setShowOverlay(false);
    }
  }, [filteredNodes]);

  const handleCloseInspector = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg)]">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div className="flex items-center gap-3">
          <Link
            href="/runs"
            className="text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors text-sm"
          >
            ←
          </Link>
          <div>
            <h1 className="text-sm font-medium text-[var(--color-text)]">{runTitle}</h1>
            <span className="text-[10px] text-[var(--color-text-muted)] font-mono">{runId}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {branches.length > 1 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-branch)]/20 text-[var(--color-branch)] border border-[var(--color-branch)]/30">
              {branches.length} branches
            </span>
          )}
          <span className="text-[10px] text-[var(--color-text-muted)]">
            {nodes.length} nodes
          </span>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Graph + streaming area */}
        <div className={`flex-1 flex flex-col ${selectedNode ? "w-2/3" : "w-full"} transition-all`}>
          {/* Graph */}
          <div className="flex-1 relative">
            <ReplayGraph
              nodes={filteredNodes}
              activeIndex={activeIndex}
              selectedNodeId={selectedNodeId}
              onNodeClick={handleNodeClick}
            />

            {/* Play overlay */}
            {showOverlay && (
              <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-bg)]/60 backdrop-blur-sm z-10">
                <button
                  onClick={handlePlay}
                  className="w-20 h-20 rounded-full bg-[var(--color-accent)]/20 border-2 border-[var(--color-accent)] flex items-center justify-center text-[var(--color-accent)] text-3xl hover:bg-[var(--color-accent)]/30 hover:scale-110 transition-all"
                >
                  ▶
                </button>
              </div>
            )}
          </div>

          {/* Streaming text */}
          <div className="h-48 border-t border-[var(--color-border)] overflow-y-auto bg-[var(--color-bg-secondary)]">
            <StreamingText node={activeNode} isPlaying={isPlaying} />
          </div>
        </div>

        {/* Inspector panel */}
        {selectedNode && (
          <div className="w-[380px] border-l border-[var(--color-border)] overflow-hidden">
            <NodeInspector
              node={selectedNode}
              policyEvent={selectedPolicyEvent}
              runId={runId}
              onClose={handleCloseInspector}
            />
          </div>
        )}
      </div>

      {/* Controls */}
      <ReplayControls
        nodes={filteredNodes}
        branches={branches}
        activeIndex={activeIndex}
        isPlaying={isPlaying}
        playbackSpeed={playbackSpeed}
        selectedBranchId={selectedBranchId}
        onPlay={handlePlay}
        onPause={handlePause}
        onNext={handleNext}
        onPrev={handlePrev}
        onScrub={handleScrub}
        onSpeedChange={setPlaybackSpeed}
        onBranchChange={setSelectedBranchId}
        onJumpToFailure={handleJumpToFailure}
      />
    </div>
  );
}
