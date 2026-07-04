import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createRunnerTokenValue,
  RUNNER_TOKEN_TTL_MS,
} from "@/lib/runner/token";
import { getSessionUserId } from "@/lib/session";

// POST /api/runner/token (TRD §7): the authenticated browser mints a pairing
// token for a workspace, which the user hands to `npx nodecode-runner`. The
// token — not the session cookie — authorizes the runner and the WS relay.

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { workspaceId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, userId },
  });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  // One live pairing token per workspace: clear old ones, then issue fresh.
  await prisma.workspaceToken.deleteMany({ where: { workspaceId } });
  const token = createRunnerTokenValue();
  const expiresAt = new Date(Date.now() + RUNNER_TOKEN_TTL_MS);
  await prisma.workspaceToken.create({
    data: { workspaceId, token, expiresAt },
  });

  const relayUrl =
    process.env.NEXT_PUBLIC_RELAY_URL ?? "ws://localhost:3001";
  return NextResponse.json({ token, relayUrl, expiresAt });
}
