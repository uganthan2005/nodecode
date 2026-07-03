"use client";

import { type NodeProps, type Node } from "@xyflow/react";
import { FileCode2 } from "lucide-react";
import { memo } from "react";
import type { ModuleNodeData } from "@/lib/canvas/types";

// Module Node (TRD §2): a bounding box representing one source file,
// containing that file's Function Nodes as children.

function ModuleNodeComponent({
  data,
  selected,
}: NodeProps<Node<ModuleNodeData, "moduleNode">>) {
  return (
    <div
      className={`h-full w-full rounded-[2px] border bg-card/40 backdrop-blur-[1px] ${
        selected ? "border-neon-blue/70" : "border-slate-subtle/60"
      }`}
    >
      <div className="flex items-center gap-1.5 border-b border-slate-subtle/40 px-3 py-2.5">
        <FileCode2 className="size-3.5 shrink-0 text-neon-blue" />
        <span className="truncate font-mono text-xs text-foreground/90">
          {data.fileName}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
          {data.entityCount}
        </span>
      </div>
    </div>
  );
}

export const ModuleNode = memo(ModuleNodeComponent);
