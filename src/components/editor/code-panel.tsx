"use client";

import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { ChevronRight, Lock, LockOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { postSync } from "@/lib/canvas/sync-client";
import type { FunctionNodeData } from "@/lib/canvas/types";
import { useCanvasStore } from "@/stores/canvas-store";

// Right IDE panel (App Flow §1 view 3): borderless Monaco showing the selected
// node's code. Edits push through /api/canvas/sync debounced by 300ms (TRD §2).
// The buffer is intentionally local — server rebuilds must never interrupt
// typing; renames re-bind the editing session instead of resetting it.

const SYNC_DEBOUNCE_MS = 300;

interface EditSession {
  nodeId: string;
  filePath: string;
  entityName: string;
}

const defineTheme: BeforeMount = (monaco) => {
  monaco.editor.defineTheme("nodecode-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "00D1FF" },
      { token: "string", foreground: "FF4655" },
      { token: "identifier", foreground: "F5F5F5" },
      { token: "comment", foreground: "6B6B6B" },
      { token: "number", foreground: "00FFA3" },
      { token: "type", foreground: "00FFA3" },
    ],
    colors: {
      "editor.background": "#0a0a0a",
      "editor.foreground": "#f5f5f5",
      "editorLineNumber.foreground": "#404040",
      "editorLineNumber.activeForeground": "#8f8f8f",
      "editorCursor.foreground": "#00d1ff",
      "editor.selectionBackground": "#00d1ff33",
      "editor.lineHighlightBackground": "#141414",
      "editorWidget.background": "#141414",
      "scrollbarSlider.background": "#40404066",
    },
  });
  // The buffer is a code FRAGMENT (e.g. a lone class method) — Monaco's own
  // TS workers would drown it in false errors. The server AST is the authority.
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
  });
};

export function CodePanel({ workspaceId }: { workspaceId: string }) {
  const {
    selectedNodeId,
    rawNodes,
    syncStatus,
    syncPaused,
    diagnostics,
  } = useCanvasStore(
    useShallow((s) => ({
      selectedNodeId: s.selectedNodeId,
      rawNodes: s.rawNodes,
      syncStatus: s.syncStatus,
      syncPaused: s.syncPaused,
      diagnostics: s.diagnostics,
    })),
  );
  const applyServerGraph = useCanvasStore((s) => s.applyServerGraph);
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);
  const setSyncStatus = useCanvasStore((s) => s.setSyncStatus);
  const setSyncPaused = useCanvasStore((s) => s.setSyncPaused);

  const [buffer, setBuffer] = useState("");
  const sessionRef = useRef<EditSession | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef<string | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);

  const selectedNode = rawNodes.find(
    (n) => n.id === selectedNodeId && n.type === "functionNode",
  );
  const nodeData = selectedNode?.data as FunctionNodeData | undefined;

  // Bind the editing session when the user selects a different node
  useEffect(() => {
    if (!selectedNode || !nodeData) {
      sessionRef.current = null;
      setBuffer("");
      return;
    }
    if (sessionRef.current?.nodeId !== selectedNode.id) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      sessionRef.current = {
        nodeId: selectedNode.id,
        filePath: nodeData.fileName,
        entityName: nodeData.functionName,
      };
      setBuffer(nodeData.rawCode);
      setSyncStatus("synced");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id]);

  const syncBuffer = useCallback(
    async (code: string) => {
      const session = sessionRef.current;
      if (!session) return;
      if (inFlightRef.current) {
        pendingRef.current = code;
        return;
      }
      inFlightRef.current = true;
      setSyncStatus("saving");

      const outcome = await postSync(workspaceId, [
        {
          op: "updateEntity",
          filePath: session.filePath,
          entityName: session.entityName,
          newCode: code,
        },
      ]);

      if (outcome.ok) {
        if (outcome.renamedTo && sessionRef.current?.nodeId === session.nodeId) {
          const newId = `fn:${session.filePath}#${outcome.renamedTo}`;
          sessionRef.current = {
            nodeId: newId,
            filePath: session.filePath,
            entityName: outcome.renamedTo,
          };
          if (outcome.canvasState) {
            applyServerGraph(
              outcome.canvasState.nodes as never,
              outcome.canvasState.edges as never,
            );
          }
          setSelectedNode(newId);
        } else if (outcome.canvasState) {
          applyServerGraph(
            outcome.canvasState.nodes as never,
            outcome.canvasState.edges as never,
          );
        }
        setSyncStatus("synced");
      } else if (outcome.kind === "ast-error") {
        setSyncStatus("ast-error", outcome.diagnostics);
      } else {
        setSyncStatus("sync-error");
      }

      inFlightRef.current = false;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending !== null && pending !== code) {
        void syncBuffer(pending);
      }
    },
    [workspaceId, applyServerGraph, setSelectedNode, setSyncStatus],
  );

  const handleChange = useCallback(
    (value: string | undefined) => {
      const code = value ?? "";
      setBuffer(code);
      if (syncPaused) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void syncBuffer(code), SYNC_DEBOUNCE_MS);
    },
    [syncPaused, syncBuffer],
  );

  // Lock Sync toggle: unpausing flushes the buffer immediately
  const togglePause = useCallback(() => {
    const next = !syncPaused;
    setSyncPaused(next);
    if (!next && sessionRef.current) void syncBuffer(buffer);
  }, [syncPaused, setSyncPaused, syncBuffer, buffer]);

  // Server syntax diagnostics → red squiggles (App Flow §4)
  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!monaco || !model) return;
    monaco.editor.setModelMarkers(
      model,
      "nodecode-ast",
      diagnostics.map((d) => ({
        severity: monaco.MarkerSeverity.Error,
        message: d.message,
        startLineNumber: d.line,
        startColumn: 1,
        endLineNumber: d.line,
        endColumn: model.getLineMaxColumn(Math.min(d.line, model.getLineCount())),
      })),
    );
  }, [diagnostics]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  };

  const breadcrumbs = nodeData?.fileName.split("/") ?? [];

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a]">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-card/60 px-3 font-mono text-xs">
        {breadcrumbs.length > 0 ? (
          <>
            {breadcrumbs.map((segment, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3 text-slate-subtle" />}
                <span
                  className={
                    i === breadcrumbs.length - 1
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }
                >
                  {segment}
                </span>
              </span>
            ))}
            <ChevronRight className="size-3 text-slate-subtle" />
            <span className="text-neon-blue">{nodeData?.functionName}</span>
          </>
        ) : (
          <span className="text-muted-foreground">no node selected</span>
        )}
        <button
          type="button"
          onClick={togglePause}
          title={
            syncPaused
              ? "Sync paused — click to resume and push changes"
              : "Lock Sync: pause bi-directional sync while writing long edits"
          }
          className={`ml-auto flex items-center gap-1.5 rounded-[2px] border px-2 py-0.5 transition-colors ${
            syncPaused
              ? "border-neon-red/60 text-neon-red"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {syncPaused ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
          {syncPaused ? "sync locked" : "live sync"}
        </button>
      </div>

      {nodeData?.scaffold === "pending" && (
        <div className="shrink-0 border-b border-neon-green/30 bg-neon-green/[0.06] px-3 py-2">
          <p className="font-mono text-[11px] uppercase tracking-wider text-neon-green/80">
            skeleton — awaiting AI code generation
          </p>
          {typeof nodeData.description === "string" && (
            <p className="mt-1 text-xs text-muted-foreground">{nodeData.description}</p>
          )}
        </div>
      )}

      {nodeData ? (
        <Editor
          language="typescript"
          theme="nodecode-dark"
          value={buffer}
          onChange={handleChange}
          beforeMount={defineTheme}
          onMount={handleMount}
          options={{
            fontFamily: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
            fontSize: 13,
            fontLigatures: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 12 },
            renderLineHighlight: "line",
            overviewRulerBorder: false,
            scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
          }}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="font-mono text-sm text-muted-foreground">
            {"> select a function node"}
          </p>
          <p className="text-xs text-muted-foreground/60">
            Click any node on the canvas to inspect and edit its code. Changes
            sync back to the module source in real time.
          </p>
        </div>
      )}

      {syncStatus === "ast-error" && (
        <div className="shrink-0 border-t border-neon-red/40 bg-neon-red/10 px-3 py-2 font-mono text-[11px] text-neon-red">
          Invalid AST syntax detected. Visual graph modifications paused until
          resolved.
        </div>
      )}
    </div>
  );
}
