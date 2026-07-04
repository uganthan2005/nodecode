import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { create } from "zustand";
import type { SyncDiagnostic } from "@/lib/canvas/patches";
import type { EntityType } from "@/lib/canvas/types";

// Zustand store (TRD §2): the client-side half of the Single Source of Truth.
// Holds the RAW graph as persisted; the rendered view (semantic zoom +
// layer filters) is derived from it via deriveViewGraph.

export type CanvasStatus = "idle" | "ingesting" | "ready" | "error";

/** Footer/sync lifecycle (App Flow §3 status indicator) */
export type SyncStatus = "synced" | "saving" | "ast-error" | "sync-error";

interface CanvasStore {
  rawNodes: Node[];
  rawEdges: Edge[];
  collapsedModules: ReadonlySet<string>;
  hiddenTypes: ReadonlySet<EntityType>;
  status: CanvasStatus;
  error: string | null;
  selectedNodeId: string | null;
  syncStatus: SyncStatus;
  /** Manual "Lock Sync" toggle (UIUX §3): pause pushes while typing broken code */
  syncPaused: boolean;
  diagnostics: SyncDiagnostic[];
  setGraph: (nodes: Node[], edges: Edge[]) => void;
  /** Replace the graph after a sync WITHOUT resetting view state (zoom/filters) */
  applyServerGraph: (nodes: Node[], edges: Edge[]) => void;
  toggleModule: (moduleId: string) => void;
  setAllCollapsed: (collapsed: boolean) => void;
  toggleType: (entityType: EntityType) => void;
  setStatus: (status: CanvasStatus, error?: string | null) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setSyncStatus: (status: SyncStatus, diagnostics?: SyncDiagnostic[]) => void;
  setSyncPaused: (paused: boolean) => void;
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
  selectedNodeId: null,
  syncStatus: "synced",
  syncPaused: false,
  diagnostics: [],
  // PRD Flow A: first render is the high-level view — every module collapsed
  setGraph: (nodes, edges) =>
    set({
      rawNodes: nodes,
      rawEdges: edges,
      collapsedModules: allModuleIds(nodes),
      status: "ready",
      error: null,
    }),
  applyServerGraph: (nodes, edges) =>
    set((state) => {
      const moduleIds = allModuleIds(nodes);
      const nodeIds = new Set(nodes.map((n) => n.id));
      return {
        rawNodes: nodes,
        rawEdges: edges,
        // keep expansion state for modules that still exist
        collapsedModules: new Set(
          [...state.collapsedModules].filter((id) => moduleIds.has(id)),
        ),
        selectedNodeId:
          state.selectedNodeId && nodeIds.has(state.selectedNodeId)
            ? state.selectedNodeId
            : null,
        status: "ready",
      };
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
  setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),
  setSyncStatus: (syncStatus, diagnostics = []) =>
    set({ syncStatus, diagnostics }),
  setSyncPaused: (syncPaused) => set({ syncPaused }),
  onNodesChange: (changes) =>
    set((state) => ({ rawNodes: applyNodeChanges(changes, state.rawNodes) })),
  onEdgesChange: (changes) =>
    set((state) => ({ rawEdges: applyEdgeChanges(changes, state.rawEdges) })),
}));
