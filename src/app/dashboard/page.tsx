import Link from "next/link";
import { redirect } from "next/navigation";
import { GitBranch, Search } from "lucide-react";
import { AiPromptBar } from "@/components/dashboard/ai-prompt-bar";
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
    <div className="bg-aurora grain relative flex min-h-screen flex-1 flex-col">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-6 border-b border-border/70 bg-background/70 px-6 backdrop-blur-xl">
        <span className="text-lg font-bold tracking-tight">
          Node<span className="text-brand">Code</span>
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

      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-10">
        <section className="panel rise rounded-lg p-6">
          <AiPromptBar />
        </section>

        <section className="rise flex flex-1 flex-col gap-4" style={{ animationDelay: "0.1s" }}>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Recent Workspaces
            </h2>
            <ImportRepoDialog />
          </div>

          {workspaces.length === 0 ? (
            <div className="dot-grid flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 py-20 text-center">
              <p className="font-medium">No workspaces yet</p>
              <p className="text-sm text-muted-foreground">
                Import a GitHub repository to create your first workspace.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {workspaces.map((workspace, i) => (
                <Link
                  key={workspace.id}
                  href={`/workspace/${workspace.id}`}
                  className="rise"
                  style={{ animationDelay: `${0.16 + i * 0.05}s` }}
                >
                  <Card className="panel panel-interactive h-full gap-3 rounded-lg py-4">
                    <CardHeader className="px-4">
                      <CardTitle className="truncate text-base tracking-tight">
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
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="edge-lit relative z-10 flex h-7 items-center justify-between border-t border-border/70 bg-background/70 px-6 font-mono text-[11px] text-muted-foreground backdrop-blur-xl">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 animate-pulse rounded-full bg-neon-green" />
          System: In Sync
        </span>
        <span className="tracking-widest">NODECODE v0.1.0</span>
      </footer>
    </div>
  );
}
