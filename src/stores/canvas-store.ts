import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { create } from "zustand";
import type { EntityType } from "@/lib/canvas/types";

// Zustand store (TRD §2): the client-side half of the Single Source of Truth.
// Holds the RAW graph as persisted; the rendered view (semantic zoom +
// layer filters) is derived from it via deriveViewGraph. Phase 3 adds the
// debounced persistence + code sync.

export type CanvasStatus = "idle" | "ingesting" | "ready" | "error";

interface CanvasStore {
  rawNodes: Node[];
  rawEdges: Edge[];
  collapsedModules: ReadonlySet<string>;
  hiddenTypes: ReadonlySet<EntityType>;
  status: CanvasStatus;
  error: string | null;
  setGraph: (nodes: Node[], edges: Edge[]) => void;
  toggleModule: (moduleId: string) => void;
  setAllCollapsed: (collapsed: boolean) => void;
  toggleType: (entityType: EntityType) => void;
  setStatus: (status: CanvasStatus, error?: string | null) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
}

const allModuleIds = (nodes: Node[]): Set<string> =>
  new Set(nodes.filter((n) => n.type === "moduleNode").map((n) => n.id));

export const useCanvasStore = create<CanvasStore>((set) => ({
  rawNodes: [],
  rawEdges: [],
  collapsedModules: new Set<string>(),
  hiddenTypes: new Set<EntityType>(),
  status: "idle",
  error: null,
  // PRD Flow A: first render is the high-level view — every module collapsed
  setGraph: (nodes, edges) =>
    set({
      rawNodes: nodes,
      rawEdges: edges,
      collapsedModules: allModuleIds(nodes),
      status: "ready",
      error: null,
    }),
  toggleModule: (moduleId) =>
    set((state) => {
      const next = new Set(state.collapsedModules);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return { collapsedModules: next };
    }),
  setAllCollapsed: (collapsed) =>
    set((state) => ({
      collapsedModules: collapsed
        ? allModuleIds(state.rawNodes)
        : new Set<string>(),
    })),
  toggleType: (entityType) =>
    set((state) => {
      const next = new Set(state.hiddenTypes);
      if (next.has(entityType)) {
        next.delete(entityType);
      } else {
        next.add(entityType);
      }
      return { hiddenTypes: next };
    }),
  setStatus: (status, error = null) => set({ status, error }),
  onNodesChange: (changes) =>
    set((state) => ({ rawNodes: applyNodeChanges(changes, state.rawNodes) })),
  onEdgesChange: (changes) =>
    set((state) => ({ rawEdges: applyEdgeChanges(changes, state.rawEdges) })),
}));
