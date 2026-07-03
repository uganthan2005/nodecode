"use client";

import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { memo } from "react";
import type { FunctionNodeData } from "@/lib/canvas/types";

// Function Node (TRD §2 / UIUX §4): matte graphite, 2px corners, monospace
// header, electric-blue input (parameters) and output (return type) ports.

const TYPE_LABELS: Record<FunctionNodeData["entityType"], string> = {
  FUNCTION: "fn",
  METHOD: "method",
  CLASS: "class",
  INTERFACE: "interface",
};

function FunctionNodeComponent({
  data,
  selected,
}: NodeProps<Node<FunctionNodeData, "functionNode">>) {
  const paramPreview = data.parameters
    .map((p) => `${p.name}: ${p.type}`)
    .join(", ");

  return (
    <div
      className={`w-[240px] rounded-[2px] border bg-[#141414] px-3 py-2 font-mono transition-shadow ${
        selected
          ? "border-neon-blue shadow-[0_0_12px_rgba(0,209,255,0.35)]"
          : "border-border hover:border-neon-blue/60 hover:shadow-[0_0_8px_rgba(0,209,255,0.2)]"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="!size-2 !border-none !bg-neon-blue"
      />
      <div className="flex items-baseline gap-2">
        <span className="truncate text-[13px] font-bold text-foreground">
          {data.functionName}
        </span>
        <span className="ml-auto shrink-0 text-[10px] uppercase text-muted-foreground">
          {TYPE_LABELS[data.entityType]}
        </span>
      </div>
      <p className="truncate text-[10px] text-muted-foreground">
        ({paramPreview})
      </p>
      <p className="truncate text-[10px] text-neon-green/80">
        → {data.returnType}
      </p>
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="!size-2 !border-none !bg-neon-blue"
      />
    </div>
  );
}

export const FunctionNode = memo(FunctionNodeComponent);
