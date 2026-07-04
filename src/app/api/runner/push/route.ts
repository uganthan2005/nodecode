import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import type { CanvasNode } from "@/lib/canvas/types";
import { buildCanvasState, mergeNodePositions } from "@/lib/ingest/graph";
import { parseSources } from "@/lib/ingest/parser";
import { prisma } from "@/lib/prisma";
import { readRunnerToken, resolveWorkspaceIdByToken } from "@/lib/runner/token";

// POST /api/runner/push (TRD §7, reverse leg): the runner watches local files
// and pushes changed sources back. We update the working copies, re-run the
// ingestion pipeline, and rebuild the graph — the same SSoT path as
// /api/canvas/sync, but keyed to provided full-file sources. Token-authorized.

interface IncomingFile {
  filePath: string;
  source: string;
}

function isFile(value: unknown): value is IncomingFile {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as IncomingFile).filePath === "string" &&
    typeof (value as IncomingFile).source === "string"
  );
}

export async function POST(request: NextRequest) {
  const token = readRunnerToken(request);
  const workspaceId = await resolveWorkspaceIdByToken(token);
  if (!workspaceId) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  let body: { files?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const incoming = Array.isArray(body.files) ? body.files.filter(isFile) : [];
  if (incoming.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { canvasState: true, codeModules: true },
  });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  // Merge incoming sources over the existing working copies
  const byPath = new Map(workspace.codeModules.map((m) => [m.filePath, m.source]));
  for (const file of incoming) byPath.set(file.filePath, file.source);
  const allSources = [...byPath].map(([filePath, source]) => ({ filePath, source }));

  const parsed = parseSources(allSources);
  const parsedByPath = new Map(parsed.map((m) => [m.filePath, m]));
  const rebuilt = buildCanvasState(parsed);

  const previousNodes = (workspace.canvasState?.nodes ?? []) as unknown as CanvasNode[];
  const finalNodes = mergeNodePositions(previousNodes, rebuilt.nodes);
  const finalState = { nodes: finalNodes, edges: rebuilt.edges };

  await prisma.$transaction(
    async (tx) => {
      const moduleByPath = new Map(
        workspace.codeModules.map((m) => [m.filePath, m]),
      );
      for (const { filePath, source } of allSources) {
        const parsedModule = parsedByPath.get(filePath);
        const hash =
          parsedModule?.hash ?? createHash("sha256").update(source).digest("hex");
        const existing = moduleByPath.get(filePath);
        const moduleId = existing
          ? (await tx.codeModule.update({
              where: { id: existing.id },
              data: { source, hash },
            })).id
          : (await tx.codeModule.create({
              data: { workspaceId, filePath, source, hash },
            })).id;

        await tx.codeEntity.deleteMany({ where: { moduleId } });
        if (parsedModule && parsedModule.entities.length > 0) {
          await tx.codeEntity.createMany({
            data: parsedModule.entities.map((entity) => ({
              moduleId,
              name: entity.name.slice(0, 255),
              type: entity.type,
              startLine: entity.startLine,
              endLine: entity.endLine,
              rawCode: entity.rawCode,
            })),
          });
        }
      }
      await tx.canvasState.upsert({
        where: { workspaceId },
        update: {
          nodes: finalState.nodes as unknown as Prisma.InputJsonValue,
          edges: finalState.edges as unknown as Prisma.InputJsonValue,
        },
        create: {
          workspaceId,
          nodes: finalState.nodes as unknown as Prisma.InputJsonValue,
          edges: finalState.edges as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.workspace.update({
        where: { id: workspaceId },
        data: { updatedAt: new Date() },
      });
    },
    { timeout: 30_000 },
  );

  return NextResponse.json({ canvasState: finalState });
}
