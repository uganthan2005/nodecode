import type {
  PatchObject,
  SyncDiagnostic,
  SyncSuccess,
} from "@/lib/canvas/patches";

// Client half of POST /api/canvas/sync.

export type SyncOutcome =
  | ({ ok: true } & SyncSuccess)
  | { ok: false; kind: "ast-error"; error: string; diagnostics: SyncDiagnostic[] }
  | { ok: false; kind: "sync-error"; error: string };

export async function postSync(
  workspaceId: string,
  changes: PatchObject[],
): Promise<SyncOutcome> {
  try {
    const response = await fetch("/api/canvas/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, changes }),
    });
    const data = await response.json();
    if (response.ok) {
      return {
        ok: true,
        canvasState: data.canvasState ?? null,
        renamedTo: data.renamedTo ?? null,
      };
    }
    if (response.status === 422 && Array.isArray(data.diagnostics)) {
      return {
        ok: false,
        kind: "ast-error",
        error: typeof data.error === "string" ? data.error : "Invalid syntax",
        diagnostics: data.diagnostics,
      };
    }
    return {
      ok: false,
      kind: "sync-error",
      error: typeof data.error === "string" ? data.error : "Sync failed",
    };
  } catch {
    return { ok: false, kind: "sync-error", error: "Network error during sync" };
  }
}
