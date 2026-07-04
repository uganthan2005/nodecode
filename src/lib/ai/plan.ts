import { generateObject } from "ai";
import { z } from "zod";
import { scaffoldModel } from "@/lib/ai/client";

// Step 1 of the AI orchestration (TRD §6): force the model to emit ONLY the
// architectural skeleton — files, function nodes, their signatures, their
// descriptions, and the call edges between them. Zero logic code. The bodies
// are written later by the parallel infill workers (Step 2), each of which
// sees only its own node.

// Entities are constrained to functions (units of logic → infillable nodes)
// and interfaces (pure type shapes → already complete after Step 1). Classes
// are intentionally excluded from greenfield scaffolds to keep every node a
// single-responsibility block, per TRD §6.
const planEntitySchema = z.object({
  name: z
    .string()
    .describe("Identifier, e.g. 'hashPassword' or 'AuthRequest'. Must be a valid TS identifier."),
  type: z.enum(["function", "interface"]),
  description: z
    .string()
    .describe(
      "One or two sentences describing exactly what this entity does. For functions this is the spec an infill worker will implement against.",
    ),
  parameters: z
    .array(
      z.object({
        name: z.string(),
        type: z.string().describe("TypeScript type, e.g. 'string', 'number', 'AuthRequest'."),
      }),
    )
    .describe(
      "For functions: the parameter list. For interfaces: the fields (name + type) of the shape.",
    ),
  returnType: z
    .string()
    .describe("Function return type, e.g. 'Promise<string>' or 'boolean'. Use '' for interfaces."),
  calls: z
    .array(z.string())
    .describe(
      "Names of OTHER entities in this plan that this function invokes. Drives the graph edges. Empty for interfaces.",
    ),
});

const planModuleSchema = z.object({
  filePath: z
    .string()
    .describe("Repo-relative path ending in .ts, e.g. 'src/auth/password.ts'."),
  entities: z.array(planEntitySchema).min(1),
});

export const architecturePlanSchema = z.object({
  projectName: z
    .string()
    .describe("Short kebab-or-title name for the project, e.g. 'ts-auth-api'."),
  summary: z.string().describe("One-sentence description of what the project does."),
  database: z
    .enum(["postgres", "redis", "none"])
    .describe("Backing datastore the project needs, or 'none'. Drives DevOps envelope generation."),
  modules: z.array(planModuleSchema).min(1).max(20),
});

export type ArchitecturePlan = z.infer<typeof architecturePlanSchema>;
export type PlanEntity = z.infer<typeof planEntitySchema>;

const SYSTEM_PROMPT = `You are the architecture planner for NodeCode, a visual TypeScript IDE.

Your ONLY job is to produce the STRUCTURAL SKELETON of a project: which files exist, which functions and interfaces live in each, their signatures, a short spec for each, and which functions call which. This becomes an interactive node graph the user approves before any code is written.

STRICT RULES:
- Output ONLY structure. NEVER write function bodies or logic — that happens in a later step.
- Every function is a single-responsibility unit. Prefer many small functions over few large ones.
- Use "calls" to wire the data flow: list, by name, the other planned functions each function invokes. This draws the edges of the graph.
- Model shared data shapes as "interface" entities (their "parameters" are the fields).
- Target modern Next.js/TypeScript. Keep the whole plan to roughly 4-15 functions for an MVP.
- Names must be valid TypeScript identifiers. File paths must be repo-relative and end in .ts.`;

export async function generateArchitecturePlan(
  prompt: string,
): Promise<ArchitecturePlan> {
  const { object } = await generateObject({
    model: scaffoldModel(),
    schema: architecturePlanSchema,
    system: SYSTEM_PROMPT,
    prompt: `Design the architecture skeleton for this project:\n\n${prompt}`,
  });
  return object;
}
