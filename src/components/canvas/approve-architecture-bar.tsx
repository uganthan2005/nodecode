"use client";

import { Check, Loader2, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import type { FunctionNodeData } from "@/lib/canvas/types";
import { useCanvasStore } from "@/stores/canvas-store";

// Skeleton-approval gate (TRD §6 / PRD Flow B): a scaffolded graph starts as
// stubs. The user reviews the structure, then approves — kicking off the
// parallel infill workers that write the real code into each node.

export function ApproveArchitectureBar({ workspaceId }: { workspaceId: string }) {
  const { rawNodes } = useCanvasStore(
    useShallow((s) => ({ rawNodes: s.rawNodes })),
  );
  const applyServerGraph = useCanvasStore((s) => s.applyServerGraph);

  const [infilling, setInfilling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingCount = useMemo(
    () =>
      rawNodes.filter(
        (n) =>
          n.type === "functionNode" &&
          (n.data as FunctionNodeData).scaffold === "pending",
      ).length,
    [rawNodes],
  );

  if (pendingCount === 0) return null;

  async function handleApprove() {
    setInfilling(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/infill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Code generation failed");
        setInfilling(false);
        return;
      }
      applyServerGraph(data.canvasState.nodes, data.canvasState.edges);
      setInfilling(false);
    } catch {
      setError("Network error during code generation");
      setInfilling(false);
    }
  }

  return (
    <>
      <div className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex justify-center">
        <div className="mt-3 flex items-center gap-3 rounded-sm border border-neon-green/40 bg-card/90 px-4 py-2 shadow-lg backdrop-blur">
          <Sparkles className="size-4 text-neon-green" />
          <span className="font-mono text-xs text-muted-foreground">
            Architecture skeleton ready —{" "}
            <span className="text-foreground">{pendingCount}</span> function
            {pendingCount === 1 ? "" : "s"} awaiting code
          </span>
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={infilling}
            className="h-7 gap-1.5 bg-neon-green px-3 text-xs font-semibold text-background hover:bg-neon-green/90"
          >
            {infilling ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            Approve & Generate Code
          </Button>
        </div>
      </div>

      {error && (
        <div className="pointer-events-none absolute inset-x-0 top-14 z-20 flex justify-center">
          <p className="rounded-sm border border-neon-red/50 bg-neon-red/10 px-3 py-1 font-mono text-xs text-neon-red backdrop-blur">
            {error}
          </p>
        </div>
      )}

      {infilling && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-background/85 backdrop-blur-sm">
          <div className="scanlines flex flex-col items-center gap-3">
            <Loader2 className="size-9 animate-spin text-neon-green" />
            <p className="font-mono text-sm text-neon-green">
              {"> infill workers writing code..."}
            </p>
            <p className="font-mono text-[11px] text-neon-green/60">
              generating {pendingCount} function{pendingCount === 1 ? "" : "s"} in
              parallel
            </p>
          </div>
        </div>
      )}
    </>
  );
}
