import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { create } from "zustand";

// Zustand store (TRD §2): the client-side half of the Single Source of Truth.
// Phase 2 is read-only — node drags mutate positions locally; persistence
// and bi-directional code sync arrive in Phase 3.

export type CanvasStatus = "idle" | "ingesting" | "ready" | "error";

interface CanvasStore {
  nodes: Node[];
  edges: Edge[];
  status: CanvasStatus;
  error: string | null;
  selectedNodeId: string | null;
  setGraph: (nodes: Node[], edges: Edge[]) => void;
  setStatus: (status: CanvasStatus, error?: string | null) => void;
  setSelectedNode: (nodeId: string | null) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
}

export const useCanvasStore = create<CanvasStore>((set) => ({
  nodes: [],
  edges: [],
  status: "idle",
  error: null,
  selectedNodeId: null,
  setGraph: (nodes, edges) => set({ nodes, edges, status: "ready", error: null }),
  setStatus: (status, error = null) => set({ status, error }),
  setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),
  onNodesChange: (changes) =>
    set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) })),
  onEdgesChange: (changes) =>
    set((state) => ({ edges: applyEdgeChanges(changes, state.edges) })),
}));
