import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { AiNotConfiguredError, hasAnthropicKey } from "@/lib/ai/client";
import { generateArchitecturePlan } from "@/lib/ai/plan";
import { synthesizeSkeleton } from "@/lib/ai/skeleton";
import type { CanvasNode, FunctionNodeData } from "@/lib/canvas/types";
import { buildCanvasState } from "@/lib/ingest/graph";
import { parseSources } from "@/lib/ingest/parser";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session";

// POST /api/ai/scaffold (TRD §5/§6): Step 1 of AI orchestration. Turns a
// natural-language prompt into a STRUCTURAL skeleton — an architecture plan,
// compilable stub files, and a CanvasState graph — persisted as a new
// repo-less workspace. No logic code yet; that is the infill step, run after
// the user approves the graph.

// Longer budget: the plan is a single large structured generation.
export const maxDuration = 120;

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

  let body: { prompt?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length < 8) {
    return NextResponse.json(
      { error: "Describe the project in a sentence or two (min 8 characters)." },
      { status: 400 },
    );
  }

  try {
    // Step 1: structure only
    const plan = await generateArchitecturePlan(prompt);
    const { files, descriptions } = synthesizeSkeleton(plan);

    // Reuse the ingestion graph builder so scaffolds and imported repos share
    // one layout + edge-resolution path.
    const parsed = parseSources(files);
    if (parsed.length === 0) {
      return NextResponse.json(
        { error: "The AI plan produced no usable entities. Try rephrasing the prompt." },
        { status: 422 },
      );
    }
    const canvasState = buildCanvasState(parsed);

    // Tag function nodes as skeleton stubs and carry the plan spec into node
    // data so the infill workers (a later request) can read it back.
    const nodes = canvasState.nodes.map((node): CanvasNode => {
      if (node.type !== "functionNode") return node;
      const data = node.data as FunctionNodeData;
      const description = descriptions.get(`${data.fileName}#${data.functionName}`);
      return {
        ...node,
        data: {
          ...data,
          description,
          // Interfaces are complete after Step 1; only functions await infill.
          ...(data.entityType === "INTERFACE" ? {} : { scaffold: "pending" as const }),
        },
      };
    });
    const finalState = { nodes, edges: canvasState.edges };

    const parsedByPath = new Map(parsed.map((m) => [m.filePath, m]));

    const workspace = await prisma.$transaction(
      async (tx) => {
        const created = await tx.workspace.create({
          data: {
            userId,
            name: plan.projectName || "AI Project",
            repoUrl: null,
            currentBranch: "main",
          },
        });
        for (const file of files) {
          const module = parsedByPath.get(file.filePath);
          await tx.codeModule.create({
            data: {
              workspaceId: created.id,
              filePath: file.filePath,
              hash: module?.hash ?? "",
              source: file.source,
              entities: module
                ? {
                    createMany: {
                      data: module.entities.map((entity) => ({
                        name: entity.name.slice(0, 255),
                        type: entity.type,
                        startLine: entity.startLine,
                        endLine: entity.endLine,
                        rawCode: entity.rawCode,
                      })),
                    },
                  }
                : undefined,
            },
          });
        }
        await tx.canvasState.create({
          data: {
            workspaceId: created.id,
            nodes: finalState.nodes as unknown as Prisma.InputJsonValue,
            edges: finalState.edges as unknown as Prisma.InputJsonValue,
          },
        });
        return created;
      },
      { timeout: 30_000 },
    );

    return NextResponse.json({
      workspaceId: workspace.id,
      canvasState: finalState,
      plan: {
        projectName: plan.projectName,
        summary: plan.summary,
        database: plan.database,
        modules: plan.modules.length,
      },
    });
  } catch (error) {
    if (error instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("AI scaffold failed:", error);
    const message = error instanceof Error ? error.message : "Scaffolding failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
