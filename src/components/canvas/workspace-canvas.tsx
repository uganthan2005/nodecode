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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { FunctionNode } from "@/components/canvas/function-node";
import { ModuleNode } from "@/components/canvas/module-node";
import { Button } from "@/components/ui/button";
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
  const { nodes, edges, status, error, onNodesChange, onEdgesChange } =
    useCanvasStore(
      useShallow((s) => ({
        nodes: s.nodes,
        edges: s.edges,
        status: s.status,
        error: s.error,
        onNodesChange: s.onNodesChange,
        onEdgesChange: s.onEdgesChange,
      })),
    );
  const setGraph = useCanvasStore((s) => s.setGraph);
  const setStatus = useCanvasStore((s) => s.setStatus);
  const ingestStartedRef = useRef(false);

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

  // Seed the store from the server snapshot; auto-ingest on first visit
  // (PRD Flow A: URL in → loading screen → graph out).
  useEffect(() => {
    if (initialNodes.length > 0) {
      setGraph(initialNodes, initialEdges);
    } else if (hasRepo && !ingestStartedRef.current) {
      ingestStartedRef.current = true;
      void runIngest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
        nodesConnectable={false}
        deleteKeyCode={null}
        className="!bg-background"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--slate-subtle)"
        />
        <Controls
          position="top-left"
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
          title="Re-clone the repository and rebuild the graph"
          className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-[2px] border bg-card/80 px-3 py-1.5 font-mono text-xs text-muted-foreground backdrop-blur transition-colors hover:border-neon-blue/60 hover:text-foreground"
        >
          <RefreshCw className="size-3.5" />
          Re-sync
        </button>
      )}
    </div>
  );
}
