"use client";

import { GitCommit, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useRunnerStore } from "@/stores/runner-store";

// Source Control tab (Phase 5 §3): git status/diff/commit UI, talking to the
// local nodecode-runner's git wrappers over the shared relay connection.

interface GitFile {
  status: string;
  path: string;
}

export function SourceControlPanel({ workspaceId }: { workspaceId: string }) {
  const [branch, setBranch] = useState<string | null>(null);
  const [files, setFiles] = useState<GitFile[] | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitOk, setCommitOk] = useState(false);

  const connState = useRunnerStore((s) => s.connState);
  const connect = useRunnerStore((s) => s.connect);
  const sendGit = useRunnerStore((s) => s.sendGit);
  const subscribeGit = useRunnerStore((s) => s.subscribeGit);
  const setDiffView = useRunnerStore((s) => s.setDiffView);

  const online = connState === "online";

  const refresh = useCallback(() => {
    sendGit({ type: "git:status" });
  }, [sendGit]);

  useEffect(() => {
    void connect(workspaceId);
    const unsubscribe = subscribeGit((msg) => {
      if (msg.type === "git:status") {
        setBranch(String(msg.branch ?? "unknown"));
        setFiles((msg.files as GitFile[]) ?? []);
      } else if (msg.type === "git:diff") {
        setDiffView({
          filePath: String(msg.filePath),
          original: String(msg.original ?? ""),
          modified: String(msg.modified ?? ""),
        });
      } else if (msg.type === "git:commit") {
        setCommitting(false);
        if (msg.ok) {
          setCommitOk(true);
          setMessage("");
          setCommitError(null);
          setTimeout(() => setCommitOk(false), 2000);
          sendGit({ type: "git:status" });
        } else {
          setCommitError(String(msg.error ?? "commit failed"));
        }
      } else if (msg.type === "git:error") {
        setCommitting(false);
        setCommitError(String(msg.message ?? "git error"));
      }
    });
    return unsubscribe;
  }, [workspaceId, connect, subscribeGit, setDiffView, sendGit]);

  useEffect(() => {
    if (online) refresh();
  }, [online, refresh]);

  const openDiff = (path: string) => {
    setActivePath(path);
    sendGit({ type: "git:diff", filePath: path });
  };

  const commit = () => {
    if (!message.trim()) return;
    setCommitting(true);
    setCommitError(null);
    sendGit({ type: "git:commit", message: message.trim() });
  };

  if (!online) {
    return (
      <div className="p-3 font-mono text-xs text-muted-foreground">
        Connect a runner to see local git status.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border/70 px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
        <span className="truncate">git: {branch ?? "…"}</span>
        <button
          type="button"
          onClick={refresh}
          title="Refresh status"
          className="ml-auto transition-colors hover:text-foreground"
        >
          <RefreshCw className="size-3" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {files === null ? (
          <p className="p-3 font-mono text-xs text-muted-foreground">loading status…</p>
        ) : files.length === 0 ? (
          <p className="p-3 font-mono text-xs text-muted-foreground">working tree clean</p>
        ) : (
          files.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => openDiff(f.path)}
              className={`flex w-full items-center gap-2 px-2 py-1 text-left font-mono text-xs transition-colors hover:bg-muted ${
                activePath === f.path ? "bg-muted text-neon-blue" : "text-muted-foreground"
              }`}
            >
              <span className="w-4 shrink-0 text-neon-green">{f.status || "?"}</span>
              <span className="truncate">{f.path}</span>
            </button>
          ))
        )}
      </div>

      <div className="shrink-0 border-t border-border/70 p-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Commit message"
          rows={2}
          className="w-full resize-none rounded-[2px] border border-border bg-background p-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-neon-blue/60 focus:outline-none"
        />
        {commitError && (
          <p className="mt-1 font-mono text-[11px] text-neon-red">{commitError}</p>
        )}
        {commitOk && (
          <p className="mt-1 font-mono text-[11px] text-neon-green">committed & pushed</p>
        )}
        <button
          type="button"
          onClick={commit}
          disabled={!message.trim() || committing || !files?.length}
          className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-[2px] border border-neon-green/40 bg-neon-green/10 py-1.5 font-mono text-xs text-neon-green transition-colors hover:bg-neon-green/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {committing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <GitCommit className="size-3" />
          )}
          Commit & Push
        </button>
      </div>
    </div>
  );
}
