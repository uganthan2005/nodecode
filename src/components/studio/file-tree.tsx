"use client";

import { ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { moduleNodeId } from "@/lib/ingest/graph";
import type { TreeNode } from "@/lib/workspace/tree";
import { useCanvasStore } from "@/stores/canvas-store";

// Source Code Tree (Phase 5 §1): left-sidebar file explorer. Data comes from
// /api/workspace/tree (CodeModule.filePath rows — the DB durable copy, not a
// live disk walk). Clicking a file expands + pans the canvas to its module.

interface FileTreeProps {
  workspaceId: string;
}

export function FileTree({ workspaceId }: FileTreeProps) {
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const expandModule = useCanvasStore((s) => s.expandModule);
  const requestFocus = useCanvasStore((s) => s.requestFocus);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workspace/tree?workspaceId=${workspaceId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data.tree)) setTree(data.tree);
        else setError("Failed to load files");
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load files");
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const selectFile = (path: string) => {
    setActivePath(path);
    const moduleId = moduleNodeId(path);
    expandModule(moduleId);
    requestFocus(moduleId);
  };

  if (error) {
    return <p className="p-3 font-mono text-xs text-neon-red">{error}</p>;
  }
  if (!tree) {
    return (
      <p className="p-3 font-mono text-xs text-muted-foreground">loading files…</p>
    );
  }
  if (tree.length === 0) {
    return (
      <p className="p-3 font-mono text-xs text-muted-foreground">no files yet</p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 overflow-y-auto p-2 font-mono text-xs">
      {tree.map((node) => (
        <TreeEntry
          key={node.path}
          node={node}
          depth={0}
          activePath={activePath}
          onSelectFile={selectFile}
        />
      ))}
    </div>
  );
}

function TreeEntry({
  node,
  depth,
  activePath,
  onSelectFile,
}: {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  onSelectFile: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);

  if (node.type === "dir") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          className="flex w-full items-center gap-1 rounded-[2px] py-1 pr-1 text-left text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight
            className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          />
          {open ? (
            <FolderOpen className="size-3.5 shrink-0" />
          ) : (
            <Folder className="size-3.5 shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {open && (
          <div>
            {node.children.map((child) => (
              <TreeEntry
                key={child.path}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const active = activePath === node.path;

  return (
    <button
      type="button"
      onClick={() => onSelectFile(node.path)}
      title={node.path}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
      className={`flex items-center gap-1.5 rounded-[2px] py-1 pr-1 text-left transition-colors hover:bg-muted hover:text-foreground ${
        active ? "bg-muted text-neon-blue" : "text-muted-foreground"
      }`}
    >
      <File className="size-3.5 shrink-0" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}
