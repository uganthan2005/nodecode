import { createAnthropic } from "@ai-sdk/anthropic";

// Central Anthropic wiring for the AI orchestration engine (TRD §6). The key
// is read at call time from ANTHROPIC_API_KEY — never hard-coded, never sent
// to the client.
//
// Model note: the PRD's "Claude 3.5 Sonnet" was retired; the current scaffolding
// model is claude-opus-4-8. It rejects temperature/top_p/top_k, so callers must
// pass NONE of those sampling params.

export const SCAFFOLD_MODEL = "claude-opus-4-8";

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI is not configured: ANTHROPIC_API_KEY is missing on the server.");
    this.name = "AiNotConfiguredError";
  }
}

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** The scaffolding model, or throws AiNotConfiguredError if no key is present. */
export function scaffoldModel() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiNotConfiguredError();
  const anthropic = createAnthropic({ apiKey });
  return anthropic(SCAFFOLD_MODEL);
}
