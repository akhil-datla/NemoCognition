"use client";

import { create } from "zustand";

export interface ReplayState {
  activeNodeIndex: number;
  isPlaying: boolean;
  playbackSpeed: number;
  selectedNodeId: string | null;
  selectedBranchId: string | null;
  inspectorOpen: boolean;
}

interface AppState {
  replay: ReplayState;
  setActiveNodeIndex: (index: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  setSelectedNodeId: (nodeId: string | null) => void;
  setSelectedBranchId: (branchId: string | null) => void;
  setInspectorOpen: (open: boolean) => void;
  reset: () => void;
}

const initialReplay: ReplayState = {
  activeNodeIndex: -1,
  isPlaying: false,
  playbackSpeed: 1,
  selectedNodeId: null,
  selectedBranchId: null,
  inspectorOpen: false,
};

export const useAppStore = create<AppState>((set) => ({
  replay: initialReplay,
  setActiveNodeIndex: (index) =>
    set((s) => ({ replay: { ...s.replay, activeNodeIndex: index } })),
  setIsPlaying: (playing) =>
    set((s) => ({ replay: { ...s.replay, isPlaying: playing } })),
  setPlaybackSpeed: (speed) =>
    set((s) => ({ replay: { ...s.replay, playbackSpeed: speed } })),
  setSelectedNodeId: (nodeId) =>
    set((s) => ({ replay: { ...s.replay, selectedNodeId: nodeId, inspectorOpen: nodeId !== null } })),
  setSelectedBranchId: (branchId) =>
    set((s) => ({ replay: { ...s.replay, selectedBranchId: branchId } })),
  setInspectorOpen: (open) =>
    set((s) => ({ replay: { ...s.replay, inspectorOpen: open } })),
  reset: () => set({ replay: initialReplay }),
}));
