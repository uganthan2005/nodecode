import type { CanvasStateJson } from "@/lib/canvas/types";

// JSON patch protocol for POST /api/canvas/sync (TRD §5) — shared by the
// client sync helpers and the server reverse engine.

export type PatchObject =
  | { op: "moveNodes"; positions: Record<string, { x: number; y: number }> }
  | { op: "updateEntity"; filePath: string; entityName: string; newCode: string }
  | { op: "deleteEntity"; filePath: string; entityName: string };

/** Diagnostic positions are relative to the submitted code block, 1-indexed */
export interface SyncDiagnostic {
  line: number;
  column: number;
  message: string;
}

export interface SyncSuccess {
  canvasState: CanvasStateJson | null;
  /** Set when an updateEntity patch changed the entity's declared name */
  renamedTo: string | null;
}

export interface SyncFailure {
  error: string;
  diagnostics?: SyncDiagnostic[];
}
