import { redirect } from "next/navigation";
import { GitBranch, Search, Sparkles } from "lucide-react";
import { ImportRepoDialog } from "@/components/dashboard/import-repo-dialog";
import { UserMenu } from "@/components/dashboard/user-menu";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

function repoSlug(repoUrl: string | null): string | null {
  if (!repoUrl) return null;
  return repoUrl.replace(/^https:\/\/github\.com\//, "");
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/");
  }

  const workspaces = await prisma.workspace.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <header className="flex h-14 items-center gap-6 border-b bg-card/60 px-6 backdrop-blur">
        <span className="text-lg font-bold tracking-tight">
          Node<span className="text-neon-blue">Code</span>
        </span>
        <div className="relative mx-auto w-full max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 font-mono text-sm"
            placeholder="> search workspaces..."
            disabled
            title="Global search arrives in a later phase"
          />
        </div>
        <UserMenu
          username={user.username}
          email={user.email}
          avatarUrl={user.avatarUrl}
        />
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-10">
        <section className="rounded-sm border bg-card/80 p-6 backdrop-blur">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="size-4 text-neon-green" />
            <h1 className="font-semibold">What are we building today?</h1>
            <Badge variant="outline" className="ml-auto font-mono text-xs">
              Phase 4
            </Badge>
          </div>
          <Input
            className="h-12 font-mono"
            placeholder="Initialize new project via AI prompt — e.g. 'Build an API that handles CSV processing & uploads to S3'"
            disabled
            title="AI scaffolding arrives in Phase 4"
          />
        </section>

        <section className="flex flex-1 flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Recent Workspaces
            </h2>
            <ImportRepoDialog />
          </div>

          {workspaces.length === 0 ? (
            <div className="dot-grid flex flex-1 flex-col items-center justify-center gap-2 rounded-sm border border-dashed py-20 text-center">
              <p className="font-medium">No workspaces yet</p>
              <p className="text-sm text-muted-foreground">
                Import a GitHub repository to create your first workspace.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {workspaces.map((workspace) => (
                <Card
                  key={workspace.id}
                  className="gap-3 rounded-sm py-4 transition-colors hover:border-neon-blue/60"
                >
                  <CardHeader className="px-4">
                    <CardTitle className="truncate text-base">
                      {workspace.name}
                    </CardTitle>
                    {repoSlug(workspace.repoUrl) && (
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {repoSlug(workspace.repoUrl)}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="flex items-center gap-2 px-4">
                    <Badge variant="secondary" className="gap-1 font-mono text-xs">
                      <GitBranch className="size-3" />
                      {workspace.currentBranch}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {dateFormat.format(workspace.updatedAt)}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="flex h-6 items-center justify-between border-t bg-card/60 px-4 font-mono text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 animate-pulse rounded-full bg-neon-green" />
          System: In Sync
        </span>
        <span>NodeCode v0.1 — Phase 1</span>
      </footer>
    </div>
  );
}
