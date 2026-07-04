"use client";

import type { Edge, Node } from "@xyflow/react";
import { useCallback, useRef, useState } from "react";
import { WorkspaceCanvas } from "@/components/canvas/workspace-canvas";
import { CodePanel } from "@/components/editor/code-panel";

// Split-screen studio (UIUX §5 screen 2): canvas left, Monaco right,
// separated by a draggable neon-blue divider. Defaults to 70/30.

const MIN_EDITOR_PCT = 20;
const MAX_EDITOR_PCT = 55;

interface StudioShellProps {
  workspaceId: string;
  initialNodes: Node[];
  initialEdges: Edge[];
  hasRepo: boolean;
}

export function StudioShell({
  workspaceId,
  initialNodes,
  initialEdges,
  hasRepo,
}: StudioShellProps) {
  const [editorPct, setEditorPct] = useState(30);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDividerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const divider = event.currentTarget;
      divider.setPointerCapture(event.pointerId);

      const onMove = (move: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        const pct = ((rect.right - move.clientX) / rect.width) * 100;
        setEditorPct(Math.min(MAX_EDITOR_PCT, Math.max(MIN_EDITOR_PCT, pct)));
      };
      const onUp = () => {
        divider.removeEventListener("pointermove", onMove);
        divider.removeEventListener("pointerup", onUp);
      };
      divider.addEventListener("pointermove", onMove);
      divider.addEventListener("pointerup", onUp);
    },
    [],
  );

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1">
        <WorkspaceCanvas
          workspaceId={workspaceId}
          initialNodes={initialNodes}
          initialEdges={initialEdges}
          hasRepo={hasRepo}
        />
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={handleDividerPointerDown}
        className="w-[3px] shrink-0 cursor-col-resize bg-border transition-colors hover:bg-neon-blue active:bg-neon-blue"
      />
      <div style={{ width: `${editorPct}%` }} className="min-w-[280px] shrink-0">
        <CodePanel workspaceId={workspaceId} />
      </div>
    </div>
  );
}
