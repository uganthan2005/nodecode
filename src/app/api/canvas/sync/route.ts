import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import type { PatchObject } from "@/lib/canvas/patches";
import type { CanvasNode } from "@/lib/canvas/types";
import {
  buildCanvasState,
  entityNodeId,
  mergeNodePositions,
  moduleNodeId,
} from "@/lib/ingest/graph";
import { parseSources } from "@/lib/ingest/parser";
import { prisma } from "@/lib/prisma";
import { removeEntity, replaceEntityCode } from "@/lib/sync/reverse-engine";
import { getSessionUserId } from "@/lib/session";

// POST /api/canvas/sync (TRD §5): applies JSON patches from the canvas/editor
// to the DB working copies via the reverse engine, rebuilds the graph, and
// returns the authoritative CanvasState. Syntax breakage rejects with 422 and
// persists nothing (App Flow §4).

function isPatch(value: unknown): value is PatchObject {
  if (typeof value !== "object" || value === null) return false;
  const op = (value as { op?: unknown }).op;
  return op === "moveNodes" || op === "updateEntity" || op === "deleteEntity";
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { workspaceId?: unknown; changes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;
  const changes = Array.isArray(body.changes) ? body.changes.filter(isPatch) : [];
  if (!workspaceId || changes.length === 0) {
    return NextResponse.json(
      { error: "workspaceId and at least one change are required" },
      { status: 400 },
    );
  }

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, userId },
    include: { canvasState: true },
  });
  if (!workspace || !workspace.canvasState) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const modules = await prisma.codeModule.findMany({
    where: { workspaceId: workspace.id },
  });
  const moduleByPath = new Map(modules.map((m) => [m.filePath, m]));

  let canvasNodes = workspace.canvasState.nodes as unknown as CanvasNode[];
  let positionsDirty = false;
  // filePath -> mutated source (chained mutations see prior results)
  const mutatedSources = new Map<string, string>();
  let lastCodePatch: { filePath: string; entityName: string } | null = null;

  for (const change of changes) {
    if (change.op === "moveNodes") {
      canvasNodes = canvasNodes.map((node) =>
        change.positions[node.id]
          ? { ...node, position: change.positions[node.id] }
          : node,
      );
      positionsDirty = true;
      continue;
    }

    const module = moduleByPath.get(change.filePath);
    if (!module) {
      return NextResponse.json(
        { error: `Module not found: ${change.filePath}` },
        { status: 404 },
      );
    }
    const currentSource = mutatedSources.get(change.filePath) ?? module.source;

    const result =
      change.op === "updateEntity"
        ? replaceEntityCode(change.filePath, currentSource, change.entityName, change.newCode)
        : removeEntity(change.filePath, currentSource, change.entityName);

    if (!result.ok) {
      if ("notFound" in result) {
        return NextResponse.json(
          { error: `Entity not found: ${change.entityName} in ${change.filePath}` },
          { status: 404 },
        );
      }
      return NextResponse.json(
        {
          error:
            "Invalid AST syntax detected. Visual graph modifications paused until resolved.",
          diagnostics: result.diagnostics,
        },
        { status: 422 },
      );
    }

    mutatedSources.set(change.filePath, result.newSource);
    if (change.op === "updateEntity") {
      lastCodePatch = { filePath: change.filePath, entityName: change.entityName };
    }
  }

  // Pure position sync — patch the CanvasState JSON only
  if (mutatedSources.size === 0) {
    if (positionsDirty) {
      await prisma.canvasState.update({
        where: { workspaceId: workspace.id },
        data: { nodes: canvasNodes as unknown as Prisma.InputJsonValue },
      });
    }
    return NextResponse.json({ canvasState: null, renamedTo: null });
  }

  // Code changed — re-parse every working copy and rebuild the graph
  const currentSources = modules.map((m) => ({
    filePath: m.filePath,
    source: mutatedSources.get(m.filePath) ?? m.source,
  }));
  const parsed = parseSources(currentSources);
  const parsedByPath = new Map(parsed.map((m) => [m.filePath, m]));
  const rebuilt = buildCanvasState(parsed);

  // Rename detection: the edited entity's declared name changed in the buffer
  let renamedTo: string | null = null;
  const renameMap = new Map<string, string>();
  if (lastCodePatch) {
    const afterNames = new Set(
      parsedByPath.get(lastCodePatch.filePath)?.entities.map((e) => e.name) ?? [],
    );
    if (!afterNames.has(lastCodePatch.entityName)) {
      const beforeNames = new Set(
        canvasNodes
          .filter((n) => n.parentId === moduleNodeId(lastCodePatch!.filePath))
          .map((n) => (n.data as { functionName?: string }).functionName),
      );
      const added = [...afterNames].filter((name) => !beforeNames.has(name));
      if (added.length === 1) {
        renamedTo = added[0];
        renameMap.set(
          entityNodeId(lastCodePatch.filePath, lastCodePatch.entityName),
          entityNodeId(lastCodePatch.filePath, renamedTo),
        );
      }
    }
  }

  const finalNodes = mergeNodePositions(canvasNodes, rebuilt.nodes, renameMap);
  const finalState = { nodes: finalNodes, edges: rebuilt.edges };

  await prisma.$transaction(
    async (tx) => {
      for (const [filePath, source] of mutatedSources) {
        const module = moduleByPath.get(filePath)!;
        const parsedModule = parsedByPath.get(filePath);
        await tx.codeModule.update({
          where: { id: module.id },
          data: {
            source,
            hash:
              parsedModule?.hash ??
              createHash("sha256").update(source).digest("hex"),
          },
        });
        await tx.codeEntity.deleteMany({ where: { moduleId: module.id } });
        if (parsedModule && parsedModule.entities.length > 0) {
          await tx.codeEntity.createMany({
            data: parsedModule.entities.map((entity) => ({
              moduleId: module.id,
              name: entity.name.slice(0, 255),
              type: entity.type,
              startLine: entity.startLine,
              endLine: entity.endLine,
              rawCode: entity.rawCode,
            })),
          });
        }
      }
      await tx.canvasState.update({
        where: { workspaceId: workspace.id },
        data: {
          nodes: finalState.nodes as unknown as Prisma.InputJsonValue,
          edges: finalState.edges as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.workspace.update({
        where: { id: workspace.id },
        data: { updatedAt: new Date() },
      });
    },
    { timeout: 30_000 },
  );

  return NextResponse.json({ canvasState: finalState, renamedTo });
}
