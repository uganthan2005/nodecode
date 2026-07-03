"use client";

import { Panel } from "@xyflow/react";
import { Expand, Shrink } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { EntityType } from "@/lib/canvas/types";
import { useCanvasStore } from "@/stores/canvas-store";

// Left canvas toolbar — "Filter Layers" (UIUX §3): toggle entity kinds and
// expand/collapse every module at once.

const LAYERS: Array<{ type: EntityType; label: string }> = [
  { type: "FUNCTION", label: "fn" },
  { type: "METHOD", label: "method" },
  { type: "CLASS", label: "class" },
  { type: "INTERFACE", label: "interface" },
];

export function FilterPanel() {
  const { hiddenTypes, toggleType, setAllCollapsed } = useCanvasStore(
    useShallow((s) => ({
      hiddenTypes: s.hiddenTypes,
      toggleType: s.toggleType,
      setAllCollapsed: s.setAllCollapsed,
    })),
  );

  return (
    <Panel
      position="top-left"
      className="flex flex-col gap-2 rounded-[2px] border bg-card/80 p-2 font-mono text-xs backdrop-blur"
    >
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setAllCollapsed(false)}
          title="Expand all modules"
          className="flex flex-1 items-center justify-center gap-1 rounded-[2px] border border-border px-2 py-1 text-muted-foreground transition-colors hover:border-neon-blue/60 hover:text-foreground"
        >
          <Expand className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => setAllCollapsed(true)}
          title="Collapse all modules"
          className="flex flex-1 items-center justify-center gap-1 rounded-[2px] border border-border px-2 py-1 text-muted-foreground transition-colors hover:border-neon-blue/60 hover:text-foreground"
        >
          <Shrink className="size-3" />
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {LAYERS.map(({ type, label }) => {
          const visible = !hiddenTypes.has(type);
          return (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type)}
              title={visible ? `Hide ${label} nodes` : `Show ${label} nodes`}
              className={`flex items-center gap-2 rounded-[2px] border px-2 py-1 transition-colors ${
                visible
                  ? "border-border text-foreground"
                  : "border-transparent text-muted-foreground line-through"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${visible ? "bg-neon-green" : "bg-slate-subtle"}`}
              />
              {label}
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
