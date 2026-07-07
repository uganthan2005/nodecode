"use client";

import { create } from "zustand";
import {
  connectBrowserRelay,
  type RelayConnection,
} from "@/lib/runner/relay-client";

// One shared browser<->relay WS connection per studio page (TRD §7, Phase 5
// §2/§3): Connect Runner dialog, the integrated terminal, and the Source
// Control tab all ride the same socket instead of each opening their own.

export type RunnerConnState = "idle" | "pairing" | "waiting" | "online" | "error";

type TermListener = (data: string) => void;
type GitListener = (msg: Record<string, unknown>) => void;

export interface DiffView {
  filePath: string;
  original: string;
  modified: string;
}

let connection: RelayConnection | null = null;
const termListeners = new Set<TermListener>();
const gitListeners = new Set<GitListener>();

interface RunnerStore {
  connState: RunnerConnState;
  token: string | null;
  error: string | null;
  workspaceId: string | null;
  /** Source Control (Phase 5 §3): the diff currently shown in the right panel */
  diffView: DiffView | null;
  connect: (workspaceId: string) => Promise<void>;
  invalidate: () => void;
  sendTermInput: (data: string) => void;
  sendTermResize: (cols: number, rows: number) => void;
  sendGit: (frame: Record<string, unknown>) => void;
  subscribeTerm: (cb: TermListener) => () => void;
  subscribeGit: (cb: GitListener) => () => void;
  setDiffView: (view: DiffView) => void;
  clearDiffView: () => void;
}

export const useRunnerStore = create<RunnerStore>((set, get) => ({
  connState: "idle",
  token: null,
  error: null,
  workspaceId: null,
  diffView: null,

  connect: async (workspaceId) => {
    const state = get();
    if (
      state.workspaceId === workspaceId &&
      state.connState !== "idle" &&
      state.connState !== "error"
    ) {
      return; // already connecting/connected for this workspace
    }
    set({ connState: "pairing", error: null, workspaceId });
    try {
      const res = await fetch("/api/runner/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await res.json();
      if (!res.ok) {
        set({
          connState: "error",
          error: typeof data.error === "string" ? data.error : "Failed to mint token",
        });
        return;
      }

      connection?.close();
      set({ token: data.token });
      connection = connectBrowserRelay(data.relayUrl, data.token, {
        onReady: (peers) =>
          set({ connState: peers.includes("runner") ? "online" : "waiting" }),
        onPeer: (role, connected) => {
          if (role === "runner") set({ connState: connected ? "online" : "waiting" });
        },
        onRunnerFileChanged: () => window.location.reload(),
        onMessage: (msg) => {
          if (msg.type === "term:output" && typeof msg.data === "string") {
            for (const cb of termListeners) cb(msg.data);
          } else if (typeof msg.type === "string" && msg.type.startsWith("git:")) {
            for (const cb of gitListeners) cb(msg);
          }
        },
        onError: () => set({ connState: "error", error: "relay connection error" }),
        onClose: () =>
          set((s) => ({ connState: s.connState === "online" ? "waiting" : s.connState })),
      });
      set({ connState: "waiting" });
    } catch {
      set({ connState: "error", error: "Network error while pairing" });
    }
  },

  invalidate: () => connection?.send({ type: "invalidate" }),
  sendTermInput: (data) => connection?.send({ type: "term:input", data }),
  sendTermResize: (cols, rows) => connection?.send({ type: "term:resize", cols, rows }),
  sendGit: (frame) => connection?.send(frame),
  subscribeTerm: (cb) => {
    termListeners.add(cb);
    return () => termListeners.delete(cb);
  },
  subscribeGit: (cb) => {
    gitListeners.add(cb);
    return () => gitListeners.delete(cb);
  },
  setDiffView: (view) => set({ diffView: view }),
  clearDiffView: () => set({ diffView: null }),
}));
