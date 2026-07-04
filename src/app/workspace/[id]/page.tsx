import type { Edge, Node } from "@xyflow/react";
import { ArrowLeft, GitBranch } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ConnectRunner } from "@/components/studio/connect-runner";
import { FooterStatus } from "@/components/studio/footer-status";
import { StudioShell } from "@/components/studio/studio-shell";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session";

// The Visual IDE Studio (App Flow §1, view 3): split-screen canvas + Monaco
// with bi-directional sync through /api/canvas/sync.

export default async function WorkspacePage(props: PageProps<"/workspace/[id]">) {
  const userId = await getSessionUserId();
  if (!userId) {
    redirect("/");
  }

  const { id } = await props.params;
  const workspace = await prisma.workspace.findFirst({
    where: { id, userId },
    include: { canvasState: true },
  });
  if (!workspace) {
    notFound();
  }

  const initialNodes = (workspace.canvasState?.nodes ?? []) as unknown as Node[];
  const initialEdges = (workspace.canvasState?.edges ?? []) as unknown as Edge[];

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b bg-card/60 px-4 backdrop-blur">
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Dashboard
        </Link>
        <span className="text-sm font-semibold">{workspace.name}</span>
        {workspace.repoUrl && (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {workspace.repoUrl.replace("https://github.com/", "")}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <ConnectRunner workspaceId={workspace.id} />
          <Badge variant="secondary" className="gap-1 font-mono text-xs">
            <GitBranch className="size-3" />
            {workspace.currentBranch}
          </Badge>
        </div>
      </header>

      <StudioShell
        workspaceId={workspace.id}
        initialNodes={initialNodes}
        initialEdges={initialEdges}
        hasRepo={workspace.repoUrl !== null}
      />

      <footer className="flex h-6 shrink-0 items-center justify-between border-t bg-card/60 px-4 font-mono text-[11px] text-muted-foreground">
        <FooterStatus />
        <span>git: {workspace.currentBranch}</span>
      </footer>
    </div>
  );
}
