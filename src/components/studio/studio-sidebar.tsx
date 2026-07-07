"use client";

import { FolderTree, GitBranch } from "lucide-react";
import { useState } from "react";
import { FileTree } from "@/components/studio/file-tree";
import { SourceControlPanel } from "@/components/studio/source-control-panel";

// Left sidebar (Phase 5 §1 & §3): File Explorer + Source Control tabs.

type SidebarTab = "explorer" | "source-control";

const TABS: Array<{ id: SidebarTab; label: string; icon: typeof FolderTree }> = [
  { id: "explorer", label: "Explorer", icon: FolderTree },
  { id: "source-control", label: "Source Control", icon: GitBranch },
];

export function StudioSidebar({ workspaceId }: { workspaceId: string }) {
  const [tab, setTab] = useState<SidebarTab>("explorer");

  return (
    <div className="flex h-full flex-col border-r border-border/70">
      <div className="flex shrink-0 border-b border-border/70">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            title={label}
            className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2 font-mono text-[11px] uppercase tracking-wide transition-colors ${
              tab === id
                ? "border-neon-blue text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="size-3.5" />
            <span className="hidden lg:inline">{label}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "explorer" ? (
          <FileTree workspaceId={workspaceId} />
        ) : (
          <SourceControlPanel workspaceId={workspaceId} />
        )}
      </div>
    </div>
  );
}
