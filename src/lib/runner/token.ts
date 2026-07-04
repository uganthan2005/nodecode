import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

// WorkspaceToken pairing (TRD §7): a short-lived secret that binds a local
// `nodecode-runner` process (and the WS relay) to one workspace. Issued from
// the authenticated browser session; consumed by the token-only runner
// endpoints and the relay's /validate check.

export const RUNNER_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
export const RUNNER_TOKEN_HEADER = "x-nodecode-token";

export function createRunnerTokenValue(): string {
  return randomBytes(32).toString("hex"); // 64 chars, fits @db.VarChar(64)
}

/** Resolves a pairing token to its (non-expired) workspace id, or null. */
export async function resolveWorkspaceIdByToken(
  token: string | null | undefined,
): Promise<string | null> {
  if (!token || token.length !== 64) return null;
  const row = await prisma.workspaceToken.findUnique({ where: { token } });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    // Best-effort GC of the expired token; never blocks the caller
    await prisma.workspaceToken
      .delete({ where: { id: row.id } })
      .catch(() => undefined);
    return null;
  }
  return row.workspaceId;
}

/** Reads the pairing token from the header or `?token=` query param. */
export function readRunnerToken(request: Request): string | null {
  const header = request.headers.get(RUNNER_TOKEN_HEADER);
  if (header) return header;
  const url = new URL(request.url);
  return url.searchParams.get("token");
}
