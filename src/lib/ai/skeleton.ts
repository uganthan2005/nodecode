import type { ArchitecturePlan, PlanEntity } from "@/lib/ai/plan";

// Bridges Step 1 (the plan) to the existing ingestion pipeline: it synthesizes
// a valid TypeScript STUB file per module. Running these stubs through the same
// parseSources + buildCanvasState path the git ingestion uses means:
//   - the skeleton graph is laid out by identical logic (no special-casing),
//   - each stub's rawCode span is byte-accurate, so the infill step can replace
//     it through the ordinary reverse engine.

export interface SkeletonFile {
  filePath: string;
  source: string;
}

/** Look-up of an entity's plan spec by "filePath#name" — carried into node data. */
export type PlanDescriptionMap = Map<string, string>;

function renderParams(params: PlanEntity["parameters"]): string {
  return params.map((p) => `${p.name}: ${p.type || "unknown"}`).join(", ");
}

function stubFunction(entity: PlanEntity): string {
  const params = renderParams(entity.parameters);
  const returnType = entity.returnType?.trim() ? `: ${entity.returnType.trim()}` : "";
  const isAsync = /^Promise\s*</.test(entity.returnType?.trim() ?? "");
  const asyncKw = isAsync ? "async " : "";
  return [
    `/** ${entity.description} */`,
    `export ${asyncKw}function ${entity.name}(${params})${returnType} {`,
    `  // NodeCode: awaiting AI code generation`,
    `  throw new Error("Not implemented: ${entity.name}");`,
    `}`,
  ].join("\n");
}

function stubInterface(entity: PlanEntity): string {
  const fields = entity.parameters.map((p) => `  ${p.name}: ${p.type || "unknown"};`);
  return [
    `/** ${entity.description} */`,
    `export interface ${entity.name} {`,
    ...fields,
    `}`,
  ].join("\n");
}

/**
 * Renders each planned module into a compilable stub file and collects the
 * per-entity descriptions (keyed by "filePath#name") so they can ride along in
 * the CanvasState node data for the infill workers to read.
 */
export function synthesizeSkeleton(plan: ArchitecturePlan): {
  files: SkeletonFile[];
  descriptions: PlanDescriptionMap;
} {
  const files: SkeletonFile[] = [];
  const descriptions: PlanDescriptionMap = new Map();

  for (const module of plan.modules) {
    const blocks = module.entities.map((entity) => {
      descriptions.set(`${module.filePath}#${entity.name}`, entity.description);
      return entity.type === "interface" ? stubInterface(entity) : stubFunction(entity);
    });
    files.push({
      filePath: module.filePath,
      source: `${blocks.join("\n\n")}\n`,
    });
  }

  return { files, descriptions };
}
