import { redirect } from "next/navigation";
import { GitBranch, Network, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSessionUserId } from "@/lib/session";

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

const ERROR_MESSAGES: Record<string, string> = {
  oauth_state_mismatch: "Login session expired or was tampered with. Try again.",
  no_verified_email: "Your GitHub account has no verified email address.",
  oauth_failed: "GitHub login failed. Try again.",
};

const FEATURES = [
  {
    icon: Network,
    title: "See the architecture",
    body: "Any TypeScript repo becomes an interactive node graph. Understand unfamiliar codebases in minutes, not days.",
  },
  {
    icon: GitBranch,
    title: "Bi-directional sync",
    body: "Edit the graph, the code rewrites itself. Edit the code, the graph updates. One deterministic source of truth.",
  },
  {
    icon: Sparkles,
    title: "AI scaffolding",
    body: "Describe a system in plain language. Review the generated architecture, approve it, and run it locally.",
  },
];

export default async function LandingPage(props: PageProps<"/">) {
  if (await getSessionUserId()) {
    redirect("/dashboard");
  }

  const searchParams = await props.searchParams;
  const errorKey = typeof searchParams.error === "string" ? searchParams.error : null;
  const errorMessage = errorKey ? (ERROR_MESSAGES[errorKey] ?? ERROR_MESSAGES.oauth_failed) : null;

  return (
    <main className="dot-grid flex flex-1 flex-col items-center justify-center gap-12 px-6 py-24">
      <div className="flex flex-col items-center gap-6 text-center">
        <p className="font-mono text-sm tracking-widest text-neon-blue">
          {"> bi-directional visual TypeScript IDE"}
        </p>
        <h1 className="text-5xl font-bold tracking-tight sm:text-7xl">
          Node<span className="text-neon-blue">Code</span>
        </h1>
        <p className="max-w-xl text-balance text-muted-foreground">
          Turn any TypeScript codebase into an interactive node graph — and turn
          node graphs back into running code.
        </p>

        {errorMessage && (
          <p className="rounded-sm border border-neon-red/50 bg-neon-red/10 px-4 py-2 font-mono text-sm text-neon-red">
            {errorMessage}
          </p>
        )}

        <Button asChild size="lg" className="gap-2">
          {/* Plain anchor: route handlers must not be client-prefetched via <Link> */}
          <a href="/api/auth/login">
            <GitHubMark className="size-5" />
            Continue with GitHub
          </a>
        </Button>
      </div>

      <div className="grid max-w-4xl gap-4 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="rounded-sm border bg-card/80 p-5 backdrop-blur transition-colors hover:border-neon-blue/60"
          >
            <Icon className="mb-3 size-5 text-neon-green" />
            <h2 className="mb-1 font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
