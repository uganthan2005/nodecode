import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session";

const GITHUB_REPO_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/;

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaces = await prisma.workspace.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ workspaces });
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { name?: unknown; repoUrl?: unknown; branch?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const repoUrl =
    typeof body.repoUrl === "string" && body.repoUrl.trim() !== ""
      ? body.repoUrl.trim().replace(/\/$/, "")
      : null;
  const branch =
    typeof body.branch === "string" && body.branch.trim() !== ""
      ? body.branch.trim()
      : "main";

  if (!name || name.length > 255) {
    return NextResponse.json(
      { error: "Workspace name is required (max 255 chars)" },
      { status: 400 },
    );
  }
  if (repoUrl && !GITHUB_REPO_URL.test(repoUrl)) {
    return NextResponse.json(
      { error: "repoUrl must be a GitHub repository URL (https://github.com/owner/repo)" },
      { status: 400 },
    );
  }

  // Workspace is born with its empty CanvasState — the SSoT snapshot exists from day one
  const workspace = await prisma.workspace.create({
    data: {
      userId,
      name,
      repoUrl,
      currentBranch: branch,
      canvasState: { create: { nodes: [], edges: [] } },
    },
    include: { canvasState: true },
  });

  return NextResponse.json({ workspace }, { status: 201 });
}
