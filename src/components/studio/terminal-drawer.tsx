"use client";

import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { ChevronDown, ChevronUp, Play, Download, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRunnerStore } from "@/stores/runner-store";

// Integrated Terminal (Phase 5 §2): a collapsible bottom drawer whose xterm.js
// instance is a thin display over the runner's shell process — stdin/stdout
// piped over the shared relay connection (term:input / term:output frames).
// No pty: the runner spawns a plain child_process shell (see runner/cli.mjs),
// so full-screen interactive programs won't render right, but this is enough
// for streaming `npm run dev` / `npm install` / `npm run lint` output.

const QUICK_ACTIONS: Array<{ label: string; icon: typeof Play; command: string }> = [
  { label: "Run Dev Server", icon: Play, command: "npm run dev" },
  { label: "Install Dependencies", icon: Download, command: "npm install" },
  { label: "Lint & Format", icon: Sparkles, command: "npm run lint" },
];

export function TerminalDrawer({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const startedRef = useRef(false);

  const connState = useRunnerStore((s) => s.connState);
  const connect = useRunnerStore((s) => s.connect);
  const sendTermInput = useRunnerStore((s) => s.sendTermInput);
  const subscribeTerm = useRunnerStore((s) => s.subscribeTerm);

  const ensureSession = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void connect(workspaceId);
  }, [connect, workspaceId]);

  // Mount the xterm.js instance once, on first render. The container div is
  // always in the DOM (visibility toggled via CSS, not conditional render) so
  // xterm never gets detached from its target node when the drawer collapses.
  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new Terminal({
      convertEol: true,
      fontSize: 12,
      fontFamily: "var(--font-jetbrains-mono), monospace",
      theme: { background: "#050505", foreground: "#e5e5e5", cursor: "#3ecf8e" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    term.onData((data) => sendTermInput(data));
    termRef.current = term;
    fitRef.current = fit;

    const unsubscribe = subscribeTerm((data) => term.write(data));

    const onResize = () => fitRef.current?.fit();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      unsubscribe();
    };
  }, [sendTermInput, subscribeTerm]);

  useEffect(() => {
    if (open) fitRef.current?.fit();
  }, [open]);

  const runQuickAction = (command: string) => {
    setOpen(true);
    ensureSession();
    sendTermInput(`${command}\r`);
    termRef.current?.focus();
  };

  const online = connState === "online";

  return (
    <div className="flex shrink-0 flex-col border-t border-border/70 bg-background">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          onClick={() => {
            setOpen((o) => !o);
            ensureSession();
          }}
          className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
          Terminal
        </button>
        <span
          className={`size-1.5 rounded-full ${online ? "bg-neon-green" : connState === "waiting" ? "bg-neon-blue animate-pulse" : "bg-slate-subtle"}`}
          title={online ? "runner online" : "waiting for runner"}
        />
        <div className="ml-auto flex gap-1.5">
          {QUICK_ACTIONS.map(({ label, icon: Icon, command }) => (
            <button
              key={label}
              type="button"
              disabled={!online}
              onClick={() => runQuickAction(command)}
              title={online ? command : "waiting for runner to connect"}
              className="flex items-center gap-1 rounded-[2px] border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-neon-blue/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground"
            >
              <Icon className="size-3" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={containerRef}
        className={`shrink-0 overflow-hidden px-2 pb-2 ${open ? "h-56" : "h-0"}`}
      />
    </div>
  );
}
