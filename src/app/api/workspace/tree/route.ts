import { NextResponse, type NextRequest } from "next/server";
import { buildFileTree } from "@/lib/workspace/tree";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session";

// GET /api/workspace/tree?workspaceId=... (Phase 5 §1): the left-sidebar File
// Explorer's data source. Session-authenticated, ownership-checked.

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, userId },
    include: { codeModules: { select: { filePath: true } } },
  });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const tree = buildFileTree(workspace.codeModules.map((m) => m.filePath));
  return NextResponse.json({ tree });
}
