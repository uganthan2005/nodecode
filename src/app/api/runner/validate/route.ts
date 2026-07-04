import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { readRunnerToken, resolveWorkspaceIdByToken } from "@/lib/runner/token";

// GET /api/runner/validate?token=... (TRD §7): the standalone WS relay is a
// dumb message pump — it holds no DB access. It calls this endpoint to turn a
// pairing token into a workspace id (the relay "room" key) before joining a
// socket to that room.

export async function GET(request: NextRequest) {
  const token = readRunnerToken(request);
  const workspaceId = await resolveWorkspaceIdByToken(token);
  if (!workspaceId) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true },
  });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  return NextResponse.json({ workspaceId: workspace.id, name: workspace.name });
}
