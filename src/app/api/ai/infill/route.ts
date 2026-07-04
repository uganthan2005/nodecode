import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { AiNotConfiguredError, hasAnthropicKey } from "@/lib/ai/client";
import { generateFunctionBodies, type InfillJob } from "@/lib/ai/infill";
import type { CanvasEdge, CanvasNode, FunctionNodeData } from "@/lib/canvas/types";
import { buildCanvasState, mergeNodePositions } from "@/lib/ingest/graph";
import { parseSources } from "@/lib/ingest/parser";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session";
import { replaceEntityCode } from "@/lib/sync/reverse-engine";

// POST /api/ai/infill (TRD §6, Step 2): the user has approved the skeleton
// graph. Parallel sub-workers write the real body for every pending function
// node, each seeing only its own spec + the signatures it calls. Generated
// code is applied through the ordinary reverse engine, then the graph is
// rebuilt and persisted. Functions whose generation fails keep their stub.

export const maxDuration = 300;

function signatureOf(data: FunctionNodeData): string {
  const params = data.parameters.map((p) => `${p.name}: ${p.type}`).join(", ");
  const ret = data.returnType ? `: ${data.returnType}` : "";
  const asyncKw = /^Promise\s*</.test(data.returnType ?? "") ? "async " : "";
  return `export ${asyncKw}function ${data.functionName}(${params})${ret}`;
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasAnthropicKey()) {
    return NextResponse.json(
      { error: "AI is not configured on this server (missing ANTHROPIC_API_KEY)." },
      { status: 503 },
    );
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
    include: { canvasState: true },
  });
  if (!workspace || !workspace.canvasState) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const canvasNodes = workspace.canvasState.nodes as unknown as CanvasNode[];
  const canvasEdges = workspace.canvasState.edges as unknown as CanvasEdge[];
  const modules = await prisma.codeModule.findMany({
    where: { workspaceId: workspace.id },
  });
  const moduleByPath = new Map(modules.map((m) => [m.filePath, m]));

  // Index nodes for signature/type look-ups
  const nodeById = new Map(canvasNodes.map((n) => [n.id, n]));
  const typeContext = canvasNodes
    .filter(
      (n) =>
        n.type === "functionNode" &&
        (n.data as FunctionNodeData).entityType === "INTERFACE",
    )
    .map((n) => (n.data as FunctionNodeData).rawCode)
    .filter(Boolean);

  // Build one job per pending function node
  const jobs: InfillJob[] = [];
  const pendingKeys = new Set<string>();
  for (const node of canvasNodes) {
    if (node.type !== "functionNode") continue;
    const data = node.data as FunctionNodeData;
    if (data.scaffold !== "pending") continue;
    const key = `${data.fileName}#${data.functionName}`;
    pendingKeys.add(key);

    const calleeSignatures = canvasEdges
      .filter((e) => e.source === node.id)
      .map((e) => nodeById.get(e.target))
      .filter((t): t is CanvasNode => Boolean(t) && t!.type === "functionNode")
      .map((t) => signatureOf(t.data as FunctionNodeData));

    jobs.push({
      key,
      filePath: data.fileName,
      entityName: data.functionName,
      description: data.description ?? `Implement ${data.functionName}.`,
      signature: signatureOf(data),
      calleeSignatures,
      typeContext,
    });
  }

  if (jobs.length === 0) {
    return NextResponse.json(
      { error: "This workspace has no pending nodes to generate." },
      { status: 400 },
    );
  }

  let generated: Map<string, string>;
  try {
    generated = await generateFunctionBodies(jobs);
  } catch (error) {
    if (error instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("AI infill failed:", error);
    return NextResponse.json({ error: "Code generation failed" }, { status: 500 });
  }

  // Apply generated bodies through the reverse engine. Chain mutations per file
  // so multiple functions in one module compose. Anything that fails to parse
  // is skipped — its stub survives and the node stays "pending".
  const mutatedSources = new Map<string, string>();
  const filledKeys = new Set<string>();
  for (const job of jobs) {
    const code = generated.get(job.key);
    if (!code) continue;
    const module = moduleByPath.get(job.filePath);
    if (!module) continue;
    const current = mutatedSources.get(job.filePath) ?? module.source;
    const result = replaceEntityCode(job.filePath, current, job.entityName, code);
    if (result.ok) {
      mutatedSources.set(job.filePath, result.newSource);
      filledKeys.add(job.key);
    }
  }

  if (mutatedSources.size === 0) {
    return NextResponse.json(
      { error: "No generated code passed validation. Try approving again." },
      { status: 422 },
    );
  }

  // Rebuild the graph from the mutated working copies
  const currentSources = modules.map((m) => ({
    filePath: m.filePath,
    source: mutatedSources.get(m.filePath) ?? m.source,
  }));
  const parsed = parseSources(currentSources);
  const parsedByPath = new Map(parsed.map((m) => [m.filePath, m]));
  const rebuilt = buildCanvasState(parsed);

  // Carry positions over, and re-tag any node that is still a stub (generation
  // failed or was skipped) so the Approve affordance persists for it.
  const descByKey = new Map<string, string | undefined>();
  for (const node of canvasNodes) {
    if (node.type !== "functionNode") continue;
    const data = node.data as FunctionNodeData;
    descByKey.set(`${data.fileName}#${data.functionName}`, data.description);
  }
  const merged = mergeNodePositions(canvasNodes, rebuilt.nodes).map((node): CanvasNode => {
    if (node.type !== "functionNode") return node;
    const data = node.data as FunctionNodeData;
    const key = `${data.fileName}#${data.functionName}`;
    if (pendingKeys.has(key) && !filledKeys.has(key) && data.entityType !== "INTERFACE") {
      return {
        ...node,
        data: { ...data, scaffold: "pending", description: descByKey.get(key) },
      };
    }
    return node;
  });
  const finalState = { nodes: merged, edges: rebuilt.edges };

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
              parsedModule?.hash ?? createHash("sha256").update(source).digest("hex"),
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
    { timeout: 60_000 },
  );

  return NextResponse.json({
    canvasState: finalState,
    filled: filledKeys.size,
    total: jobs.length,
  });
}
