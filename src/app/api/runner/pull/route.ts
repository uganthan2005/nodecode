import { NextResponse, type NextRequest } from "next/server";
import { buildEnvelope, inferDatabase } from "@/lib/runner/envelope";
import { readRunnerToken, resolveWorkspaceIdByToken } from "@/lib/runner/token";
import { prisma } from "@/lib/prisma";

// GET /api/runner/pull (TRD §7): the runner fetches the workspace's current
// working copies plus the generated Docker envelope, writes them to disk, and
// boots the environment. Token-authorized (no session).

export async function GET(request: NextRequest) {
  const token = readRunnerToken(request);
  const workspaceId = await resolveWorkspaceIdByToken(token);
  if (!workspaceId) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { codeModules: { select: { filePath: true, source: true } } },
  });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const files = workspace.codeModules.map((m) => ({
    filePath: m.filePath,
    source: m.source,
  }));
  const database = inferDatabase(files.map((f) => f.source));
  const envelope = buildEnvelope({ projectName: workspace.name, database });

  return NextResponse.json({
    workspaceId: workspace.id,
    name: workspace.name,
    database,
    files,
    envelope,
  });
}
