"use client";

import {
  Background,
  BackgroundVariant,
  BezierEdge,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type OnBeforeDelete,
  type OnNodeDrag,
  type OnNodesDelete,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { FilterPanel } from "@/components/canvas/filter-panel";
import { FunctionNode } from "@/components/canvas/function-node";
import { ModuleNode } from "@/components/canvas/module-node";
import { Button } from "@/components/ui/button";
import { deriveViewGraph } from "@/lib/canvas/derive";
import { postSync } from "@/lib/canvas/sync-client";
import type { FunctionNodeData } from "@/lib/canvas/types";
import { useCanvasStore } from "@/stores/canvas-store";

const nodeTypes = {
  functionNode: FunctionNode,
  moduleNode: ModuleNode,
};

const edgeTypes = {
  dataFlow: BezierEdge,
};

const defaultEdgeOptions = {
  type: "default" as const, // bezier
  style: { stroke: "var(--slate-subtle)", strokeWidth: 1.5 },
};

const MOVE_DEBOUNCE_MS = 300; // TRD §2: drag renders instantly, persistence debounced

interface WorkspaceCanvasProps {
  workspaceId: string;
  initialNodes: Node[];
  initialEdges: Edge[];
  hasRepo: boolean;
}

export function WorkspaceCanvas({
  workspaceId,
  initialNodes,
  initialEdges,
  hasRepo,
}: WorkspaceCanvasProps) {
  const {
    rawNodes,
    rawEdges,
    collapsedModules,
    hiddenTypes,
    status,
    error,
    syncStatus,
    onNodesChange,
    onEdgesChange,
    toggleModule,
  } = useCanvasStore(
    useShallow((s) => ({
      rawNodes: s.rawNodes,
      rawEdges: s.rawEdges,
      collapsedModules: s.collapsedModules,
      hiddenTypes: s.hiddenTypes,
      status: s.status,
      error: s.error,
      syncStatus: s.syncStatus,
      onNodesChange: s.onNodesChange,
      onEdgesChange: s.onEdgesChange,
      toggleModule: s.toggleModule,
    })),
  );
  const setGraph = useCanvasStore((s) => s.setGraph);
  const setStatus = useCanvasStore((s) => s.setStatus);
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);
  const setSyncStatus = useCanvasStore((s) => s.setSyncStatus);
  const applyServerGraph = useCanvasStore((s) => s.applyServerGraph);

  const ingestStartedRef = useRef(false);
  const pendingMovesRef = useRef<Record<string, { x: number; y: number }>>({});
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // App Flow §4: syntax breakage locks the canvas at its last good state
  const astLocked = syncStatus === "ast-error";

  const { nodes, edges } = useMemo(
    () => deriveViewGraph(rawNodes, rawEdges, collapsedModules, hiddenTypes),
    [rawNodes, rawEdges, collapsedModules, hiddenTypes],
  );

  const runIngest = useCallback(async () => {
    setStatus("ingesting");
    try {
      const response = await fetch("/api/repo/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus("error", typeof data.error === "string" ? data.error : "Ingestion failed");
        return;
      }
      setGraph(data.canvasState.nodes, data.canvasState.edges);
    } catch {
      setStatus("error", "Network error during ingestion");
    }
  }, [workspaceId, setGraph, setStatus]);

  useEffect(() => {
    if (initialNodes.length > 0) {
      setGraph(initialNodes, initialEdges);
    } else if (hasRepo && !ingestStartedRef.current) {
      ingestStartedRef.current = true;
      void runIngest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNodeDoubleClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      if (node.type === "moduleNode") toggleModule(node.id);
    },
    [toggleModule],
  );

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      if (node.type === "functionNode") setSelectedNode(node.id);
    },
    [setSelectedNode],
  );

  // Debounced position persistence
  const handleNodeDragStop = useCallback<OnNodeDrag>(
    (_, __, draggedNodes) => {
      for (const node of draggedNodes) {
        pendingMovesRef.current[node.id] = node.position;
      }
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
      moveTimerRef.current = setTimeout(() => {
        const positions = pendingMovesRef.current;
        pendingMovesRef.current = {};
        void postSync(workspaceId, [{ op: "moveNodes", positions }]);
      }, MOVE_DEBOUNCE_MS);
    },
    [workspaceId],
  );

  // Only function nodes are deletable, and never while the AST is broken
  const handleBeforeDelete = useCallback<OnBeforeDelete>(
    async ({ nodes: toDelete, edges: edgesToDelete }) => {
      if (astLocked) return false;
      const functionNodes = toDelete.filter((n) => n.type === "functionNode");
      if (functionNodes.length === 0) return false;
      return { nodes: functionNodes, edges: edgesToDelete };
    },
    [astLocked],
  );

  // Bi-directional deletion (PRD P0): removing the node splices out the code
  const handleNodesDelete = useCallback<OnNodesDelete>(
    async (deleted) => {
      const changes = deleted
        .filter((n) => n.type === "functionNode")
        .map((n) => {
          const data = n.data as FunctionNodeData;
          return {
            op: "deleteEntity" as const,
            filePath: data.fileName,
            entityName: data.functionName,
          };
        });
      if (changes.length === 0) return;

      setSyncStatus("saving");
      const outcome = await postSync(workspaceId, changes);
      if (outcome.ok) {
        if (outcome.canvasState) {
          applyServerGraph(
            outcome.canvasState.nodes as never,
            outcome.canvasState.edges as never,
          );
        }
        setSyncStatus("synced");
      } else if (outcome.kind === "ast-error") {
        setSyncStatus("ast-error", outcome.diagnostics);
      } else {
        setSyncStatus("sync-error");
      }
    },
    [workspaceId, applyServerGraph, setSyncStatus],
  );

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStop={handleNodeDragStop}
        onBeforeDelete={handleBeforeDelete}
        onNodesDelete={handleNodesDelete}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
        nodesConnectable={false}
        nodesDraggable={!astLocked}
        deleteKeyCode={astLocked ? null : "Delete"}
        zoomOnDoubleClick={false}
        className="!bg-background"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--slate-subtle)"
        />
        <FilterPanel />
        <Controls
          position="bottom-left"
          className="[&_button]:!border-border [&_button]:!bg-card [&_button]:!fill-foreground"
        />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          className="!bg-card"
          nodeColor="#2a2a2a"
          maskColor="rgba(5, 5, 5, 0.7)"
        />
      </ReactFlow>

      {astLocked && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center">
          <p className="rounded-b-[2px] border border-t-0 border-neon-red/50 bg-neon-red/10 px-4 py-1.5 font-mono text-xs text-neon-red backdrop-blur">
            canvas locked — fix the syntax error in the editor
          </p>
        </div>
      )}

      {status === "ingesting" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm">
          <Loader2 className="size-8 animate-spin text-neon-green" />
          <p className="font-mono text-sm text-neon-green">
            {"> cloning repository & generating AST..."}
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background/80 backdrop-blur-sm">
          <p className="max-w-md text-center font-mono text-sm text-neon-red">
            {error}
          </p>
          <Button variant="outline" onClick={runIngest} className="gap-2">
            <RefreshCw className="size-4" />
            Retry Ingestion
          </Button>
        </div>
      )}

      {status === "ready" && nodes.length > 0 && (
        <button
          type="button"
          onClick={runIngest}
          title="Re-clone the repository and rebuild the graph (discards code edits)"
          className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-[2px] border bg-card/80 px-3 py-1.5 font-mono text-xs text-muted-foreground backdrop-blur transition-colors hover:border-neon-blue/60 hover:text-foreground"
        >
          <RefreshCw className="size-3.5" />
          Re-sync
        </button>
      )}
    </div>
  );
}
