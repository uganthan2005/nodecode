"use client";

import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { ChevronDown, ChevronRight, FileCode2 } from "lucide-react";
import { memo } from "react";
import type { ModuleNodeData } from "@/lib/canvas/types";

// Module Node (TRD §2): a bounding box representing one source file.
// Semantic zoom (PRD P1): starts collapsed at the file level; double-click
// expands it to reveal the internal Function Nodes. While collapsed, the
// handles below carry the aggregated call edges.

function ModuleNodeComponent({
  data,
  selected,
}: NodeProps<Node<ModuleNodeData, "moduleNode">>) {
  const collapsed = data.collapsed === true;

  return (
    <div
      className={`h-full w-full rounded-[2px] border transition-colors ${
        collapsed
          ? "bg-card hover:border-neon-blue/60"
          : "bg-card/40 backdrop-blur-[1px]"
      } ${selected ? "border-neon-blue/70" : "border-slate-subtle/60"}`}
      title={collapsed ? "Double-click to expand" : "Double-click to collapse"}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className={`!size-2 !border-none !bg-neon-blue ${collapsed ? "" : "!opacity-0"}`}
      />
      <div
        className={`flex items-center gap-1.5 px-3 py-2.5 ${
          collapsed ? "" : "border-b border-slate-subtle/40"
        }`}
      >
        {collapsed ? (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <FileCode2 className="size-3.5 shrink-0 text-neon-blue" />
        <span className="truncate font-mono text-xs text-foreground/90">
          {data.fileName}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
          {data.entityCount}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className={`!size-2 !border-none !bg-neon-blue ${collapsed ? "" : "!opacity-0"}`}
      />
    </div>
  );
}

export const ModuleNode = memo(ModuleNodeComponent);
