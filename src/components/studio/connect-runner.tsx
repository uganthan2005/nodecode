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
import {
  connectBrowserRelay,
  type RelayConnection,
} from "@/lib/runner/relay-client";
import { useCanvasStore } from "@/stores/canvas-store";

// Connect Runner (TRD §7): mints a pairing token, shows the `npx nodecode-runner`
// command, and opens the browser's own relay socket so it can (a) show whether a
// runner is live and (b) tell the runner to re-pull after browser-side edits.

type RunnerState = "idle" | "pairing" | "waiting" | "online" | "error";

export function ConnectRunner({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<RunnerState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const relayRef = useRef<RelayConnection | null>(null);
  const syncStatus = useCanvasStore((s) => s.syncStatus);
  const prevSyncRef = useRef(syncStatus);

  const command = token ? `npx nodecode-runner ${token}` : "";

  const teardown = useCallback(() => {
    relayRef.current?.close();
    relayRef.current = null;
  }, []);

  const pair = useCallback(async () => {
    setState("pairing");
    setError(null);
    try {
      const res = await fetch("/api/runner/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed to mint token");
        setState("error");
        return;
      }
      setToken(data.token);
      teardown();
      relayRef.current = connectBrowserRelay(data.relayUrl, data.token, {
        onReady: (peers) => setState(peers.includes("runner") ? "online" : "waiting"),
        onPeer: (role, connected) => {
          if (role === "runner") setState(connected ? "online" : "waiting");
        },
        onRunnerFileChanged: () => {
          // Runner pushed a local edit into the graph — reload to render it.
          window.location.reload();
        },
        onError: () => setState("error"),
        onClose: () => setState((s) => (s === "online" ? "waiting" : s)),
      });
      setState("waiting");
    } catch {
      setError("Network error while pairing");
      setState("error");
    }
  }, [workspaceId, teardown]);

  // Browser-side code edits persisted → nudge the runner to re-pull
  useEffect(() => {
    if (prevSyncRef.current === "saving" && syncStatus === "synced") {
      relayRef.current?.invalidate();
    }
    prevSyncRef.current = syncStatus;
  }, [syncStatus]);

  useEffect(() => () => teardown(), [teardown]);

  const copy = useCallback(() => {
    if (!command) return;
    void navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [command]);

  const dot =
    state === "online"
      ? "bg-neon-green"
      : state === "waiting"
        ? "bg-neon-blue animate-pulse"
        : state === "error"
          ? "bg-neon-red"
          : "bg-slate-subtle";
  const label =
    state === "online"
      ? "runner online"
      : state === "waiting"
        ? "waiting for runner"
        : state === "pairing"
          ? "pairing…"
          : state === "error"
            ? "error"
            : "runner";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && !token) void pair();
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

        {state === "pairing" ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> minting pairing token…
          </div>
        ) : error ? (
          <div className="space-y-3 py-2">
            <p className="font-mono text-xs text-neon-red">{error}</p>
            <Button variant="outline" size="sm" onClick={pair}>
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
