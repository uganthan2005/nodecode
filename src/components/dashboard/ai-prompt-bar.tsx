"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

// Dashboard AI entry point (App Flow, PRD Flow B): a natural-language prompt
// posts to /api/ai/scaffold. While the architecture plan generates, a
// "Matrix Green" overlay plays; on success we route into the new workspace,
// where the user reviews and approves the skeleton before code infill.

const SCAFFOLD_STAGES = [
  "> parsing intent...",
  "> planning module boundaries...",
  "> resolving data flow edges...",
  "> drawing architecture graph...",
];

export function AiPromptBar() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (trimmed.length < 8 || loading) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/scaffold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Scaffolding failed");
        setLoading(false);
        return;
      }
      // Keep the overlay up through navigation — the workspace renders the graph
      router.push(`/workspace/${data.workspaceId}`);
    } catch {
      setError("Network error while contacting the AI engine");
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <form onSubmit={handleSubmit}>
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="size-4 text-neon-green" />
          <h1 className="font-semibold">What are we building today?</h1>
        </div>
        <div className="flex gap-2">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={loading}
            className="h-12 flex-1 rounded-sm border bg-background px-3 font-mono text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-neon-green/60 disabled:opacity-50"
            placeholder="Initialize new project via AI prompt — e.g. 'Build an API that handles CSV processing & uploads to S3'"
          />
          <Button
            type="submit"
            disabled={loading || prompt.trim().length < 8}
            className="h-12 gap-2 bg-neon-green px-5 font-semibold text-background hover:bg-neon-green/90"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Generate
          </Button>
        </div>
        {error && (
          <p className="mt-2 font-mono text-xs text-neon-red">{error}</p>
        )}
      </form>

      {loading && (
        <div className="matrix-overlay fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background/95 backdrop-blur">
          <div className="scanlines flex flex-col items-center gap-4">
            <Loader2 className="size-10 animate-spin text-neon-green" />
            <p className="font-mono text-lg text-neon-green">
              Generating architecture
            </p>
            <ul className="space-y-1 font-mono text-xs text-neon-green/70">
              {SCAFFOLD_STAGES.map((stage, i) => (
                <li
                  key={stage}
                  className="matrix-stage"
                  style={{ animationDelay: `${i * 0.6}s` }}
                >
                  {stage}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
