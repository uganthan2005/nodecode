"use client";

import { useShallow } from "zustand/react/shallow";
import { useCanvasStore } from "@/stores/canvas-store";

// Footer sync-state indicator (UIUX §3): green in sync, yellow while
// pushing, cyber red when the AST is broken.

export function FooterStatus() {
  const { status, syncStatus } = useCanvasStore(
    useShallow((s) => ({ status: s.status, syncStatus: s.syncStatus })),
  );

  if (status === "ingesting") {
    return (
      <span className="flex items-center gap-1.5 text-neon-green">
        <span className="size-1.5 animate-pulse rounded-full bg-neon-green" />
        Parsing AST...
      </span>
    );
  }
  if (syncStatus === "ast-error") {
    return (
      <span className="flex items-center gap-1.5 text-neon-red">
        <span className="size-1.5 animate-pulse rounded-full bg-neon-red" />
        Invalid AST syntax detected. Visual graph modifications paused.
      </span>
    );
  }
  if (syncStatus === "sync-error") {
    return (
      <span className="flex items-center gap-1.5 text-neon-red">
        <span className="size-1.5 rounded-full bg-neon-red" />
        Sync failed — retrying on next change
      </span>
    );
  }
  if (syncStatus === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-yellow-400">
        <span className="size-1.5 animate-pulse rounded-full bg-yellow-400" />
        Syncing...
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-1.5 animate-pulse rounded-full bg-neon-green" />
      System: In Sync
    </span>
  );
}
