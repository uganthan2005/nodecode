"use client";

import { Check, Copy, Loader2, TerminalSquare, Radio } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useCanvasStore } from "@/stores/canvas-store";
import { useRunnerStore } from "@/stores/runner-store";

// Connect Runner (TRD §7): mints a pairing token, shows the `npx nodecode-runner`
// command, and displays the shared runner connection's live status. The socket
// itself lives in useRunnerStore so the terminal and Source Control tab can
// reuse it without opening a second connection.

export function ConnectRunner({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const connState = useRunnerStore((s) => s.connState);
  const token = useRunnerStore((s) => s.token);
  const error = useRunnerStore((s) => s.error);
  const connect = useRunnerStore((s) => s.connect);
  const invalidate = useRunnerStore((s) => s.invalidate);

  const syncStatus = useCanvasStore((s) => s.syncStatus);
  const prevSyncRef = useRef(syncStatus);

  const command = token ? `npx nodecode-runner ${token}` : "";

  // Browser-side code edits persisted → nudge the runner to re-pull
  useEffect(() => {
    if (prevSyncRef.current === "saving" && syncStatus === "synced") {
      invalidate();
    }
    prevSyncRef.current = syncStatus;
  }, [syncStatus, invalidate]);

  const copy = useCallback(() => {
    if (!command) return;
    void navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [command]);

  const dot =
    connState === "online"
      ? "bg-neon-green"
      : connState === "waiting"
        ? "bg-neon-blue animate-pulse"
        : connState === "error"
          ? "bg-neon-red"
          : "bg-slate-subtle";
  const label =
    connState === "online"
      ? "runner online"
      : connState === "waiting"
        ? "waiting for runner"
        : connState === "pairing"
          ? "pairing…"
          : connState === "error"
            ? "error"
            : "runner";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void connect(workspaceId);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 font-mono text-xs">
          <TerminalSquare className="size-3.5" />
          Connect Runner
          <span className={`ml-1 size-1.5 rounded-full ${dot}`} />
        </Button>
      </DialogTrigger>
      <DialogContent className="border bg-card/90 backdrop-blur-xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="size-4 text-neon-green" />
            Run this workspace locally
          </DialogTitle>
          <DialogDescription>
            Run the command below in your project terminal. The runner writes the
            code to disk, boots the Docker envelope, and stays in live sync with
            this canvas.
          </DialogDescription>
        </DialogHeader>

        {connState === "pairing" ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> minting pairing token…
          </div>
        ) : error ? (
          <div className="space-y-3 py-2">
            <p className="font-mono text-xs text-neon-red">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void connect(workspaceId)}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-sm border bg-background p-3">
              <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-neon-green">
                {command}
              </code>
              <button
                type="button"
                onClick={copy}
                title="Copy command"
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              >
                {copied ? (
                  <Check className="size-4 text-neon-green" />
                ) : (
                  <Copy className="size-4" />
                )}
              </button>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <span className={`size-2 rounded-full ${dot}`} />
              {label}
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              Token is valid for 24h and pairs to this workspace only. Needs
              Node ≥ 20; Docker is optional (falls back to sync-only).
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
