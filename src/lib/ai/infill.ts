import { generateText } from "ai";
import { scaffoldModel } from "@/lib/ai/client";

// Step 2 of the AI orchestration (TRD §6): parallelized sub-workers. Each worker
// receives ONLY one function node — its spec, its signature, the signatures of
// the functions it may call, and the shared type shapes — and returns a single
// self-contained implementation. Isolating context per node keeps each block
// single-responsibility and reliable.

export interface InfillJob {
  /** Stable key = "filePath#entityName" */
  key: string;
  filePath: string;
  entityName: string;
  description: string;
  /** The stub declaration line, e.g. "export async function login(req: AuthRequest): Promise<Session>" */
  signature: string;
  /** Signatures of the entities this function calls — so it can invoke them correctly */
  calleeSignatures: string[];
  /** Shared interface/type definitions available in the project */
  typeContext: string[];
}

const CONCURRENCY = 4;

function stripFences(text: string): string {
  let out = text.trim();
  // Remove a single leading ```lang fence and trailing ``` if present
  const fenceStart = out.match(/^```[a-zA-Z]*\n/);
  if (fenceStart) {
    out = out.slice(fenceStart[0].length);
    const fenceEnd = out.lastIndexOf("```");
    if (fenceEnd !== -1) out = out.slice(0, fenceEnd);
  }
  return out.trim();
}

const SYSTEM_PROMPT = `You are a NodeCode code-infill worker. You implement exactly ONE TypeScript function to spec.

STRICT OUTPUT RULES:
- Output ONLY the complete function declaration, implemented. No prose, no markdown code fences, no imports, no other declarations.
- Keep the EXACT signature you are given (name, parameters, return type). You may add 'async' only if it already is async.
- Reference the provided callee signatures and type definitions by name; assume they are in scope. Do NOT redefine them.
- Write real, working logic — never a stub or "throw new Error('Not implemented')".
- Keep it single-responsibility and self-contained.`;

async function runJob(job: InfillJob): Promise<{ key: string; code: string }> {
  const callees =
    job.calleeSignatures.length > 0
      ? `\n\nFunctions you may call (already in scope):\n${job.calleeSignatures.map((s) => `- ${s}`).join("\n")}`
      : "";
  const types =
    job.typeContext.length > 0
      ? `\n\nShared types (already in scope):\n${job.typeContext.join("\n\n")}`
      : "";

  const { text } = await generateText({
    model: scaffoldModel(),
    system: SYSTEM_PROMPT,
    prompt:
      `Implement this function.\n\nSpec: ${job.description}\n\nRequired signature:\n${job.signature}` +
      callees +
      types,
  });
  return { key: job.key, code: stripFences(text) };
}

/**
 * Runs all jobs with a bounded worker pool and returns a map of job key →
 * generated function source. Jobs that fail are omitted (the stub is left in
 * place) rather than aborting the whole infill.
 */
export async function generateFunctionBodies(
  jobs: InfillJob[],
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  let cursor = 0;

  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      try {
        const { key, code } = await runJob(job);
        if (code) results.set(key, code);
      } catch (error) {
        console.error(`Infill worker failed for ${job.key}:`, error);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker),
  );
  return results;
}
