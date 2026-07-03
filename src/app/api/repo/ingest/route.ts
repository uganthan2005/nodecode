import { Octokit } from "@octokit/rest";
import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { decryptSecret } from "@/lib/crypto";
import { cloneRepo, parseRepoUrl } from "@/lib/ingest/clone";
import { buildCanvasState } from "@/lib/ingest/graph";
import { parseRepository } from "@/lib/ingest/parser";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session";

// POST /api/repo/ingest (TRD §5): clone the workspace repo into a throwaway
// temp volume, run the ts-morph pipeline, persist the catalog + CanvasState,
// and return the complete CanvasState JSON.

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
  if (!workspace.repoUrl) {
    return NextResponse.json(
      { error: "Workspace has no repository URL" },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const accessToken = user?.githubAccessToken
    ? decryptSecret(user.githubAccessToken)
    : undefined;

  // Preflight via GitHub API: clear errors + branch fallback before cloning
  const { owner, repo } = parseRepoUrl(workspace.repoUrl);
  const octokit = new Octokit({ auth: accessToken });
  let branch = workspace.currentBranch;
  try {
    const { data: repoInfo } = await octokit.repos.get({ owner, repo });
    try {
      await octokit.repos.getBranch({ owner, repo, branch });
    } catch {
      branch = repoInfo.default_branch;
      await prisma.workspace.update({
        where: { id: workspace.id },
        data: { currentBranch: branch },
      });
    }
  } catch {
    return NextResponse.json(
      { error: `Repository ${owner}/${repo} not found or not accessible` },
      { status: 404 },
    );
  }

  const { dir, cleanup } = await cloneRepo(workspace.repoUrl, branch, accessToken);
  try {
    const { modules, truncated } = parseRepository(dir);
    if (modules.length === 0) {
      return NextResponse.json(
        { error: "No TypeScript entities found in this repository" },
        { status: 422 },
      );
    }

    const canvasState = buildCanvasState(modules);

    await prisma.$transaction(
      async (tx) => {
        await tx.codeModule.deleteMany({ where: { workspaceId: workspace.id } });
        for (const module of modules) {
          await tx.codeModule.create({
            data: {
              workspaceId: workspace.id,
              filePath: module.filePath,
              hash: module.hash,
              entities: {
                createMany: {
                  data: module.entities.map((entity) => ({
                    name: entity.name.slice(0, 255),
                    type: entity.type,
                    startLine: entity.startLine,
                    endLine: entity.endLine,
                    rawCode: entity.rawCode,
                  })),
                },
              },
            },
          });
        }
        await tx.canvasState.upsert({
          where: { workspaceId: workspace.id },
          update: {
            nodes: canvasState.nodes as unknown as Prisma.InputJsonValue,
            edges: canvasState.edges as unknown as Prisma.InputJsonValue,
          },
          create: {
            workspaceId: workspace.id,
            nodes: canvasState.nodes as unknown as Prisma.InputJsonValue,
            edges: canvasState.edges as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.workspace.update({
          where: { id: workspace.id },
          data: { updatedAt: new Date() },
        });
      },
      { timeout: 60_000 },
    );

    return NextResponse.json({
      canvasState,
      stats: {
        modules: modules.length,
        entities: modules.reduce((sum, m) => sum + m.entities.length, 0),
        edges: canvasState.edges.length,
        truncated,
        branch,
      },
    });
  } catch (error) {
    console.error("Ingestion failed:", error);
    const message = error instanceof Error ? error.message : "Ingestion failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    // TRD §7 isolation: the cloned volume never outlives the request
    await cleanup();
  }
}
