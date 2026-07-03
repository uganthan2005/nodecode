"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FolderGit2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ImportRepoDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill the workspace name from the repo slug when the user hasn't typed one
  function handleRepoUrlBlur() {
    if (name.trim() !== "") return;
    const match = repoUrl.match(/github\.com\/[\w.-]+\/([\w.-]+?)\/?$/);
    if (match) setName(match[1]);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, repoUrl, branch }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Import failed");
        return;
      }
      // Straight into the studio — the canvas auto-triggers ingestion (PRD Flow A)
      router.push(`/workspace/${data.workspace.id}`);
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <FolderGit2 className="size-4" />
          Import Repository
        </Button>
      </DialogTrigger>
      <DialogContent className="border bg-card/90 backdrop-blur-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import a GitHub repository</DialogTitle>
          <DialogDescription>
            Creates a workspace bound to the repository. Parsing and canvas
            rendering arrive in Phase 2.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="repoUrl">GitHub URL</Label>
            <Input
              id="repoUrl"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              onBlur={handleRepoUrlBlur}
              className="font-mono text-sm"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Workspace name</Label>
            <Input
              id="name"
              placeholder="my-project"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="branch">Branch</Label>
            <Input
              id="branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          {error && (
            <p className="font-mono text-sm text-neon-red" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={submitting} className="gap-2">
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Create Workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
