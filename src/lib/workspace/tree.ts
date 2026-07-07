// File Explorer (Phase 5 §1): the tree is derived from CodeModule.filePath rows,
// NOT a live disk walk — Phase 3 already made the DB the durable working copy
// and temp clones get wiped right after ingest (TRD §7 /tmp hardening).

export interface TreeFileNode {
  type: "file";
  name: string;
  path: string;
}

export interface TreeDirNode {
  type: "dir";
  name: string;
  path: string;
  children: TreeNode[];
}

export type TreeNode = TreeFileNode | TreeDirNode;

export function buildFileTree(filePaths: string[]): TreeNode[] {
  const root: TreeDirNode = { type: "dir", name: "", path: "", children: [] };

  for (const filePath of filePaths) {
    const parts = filePath.split("/").filter(Boolean);
    let cursor = root;
    for (let i = 0; i < parts.length; i++) {
      const isFile = i === parts.length - 1;
      const segPath = parts.slice(0, i + 1).join("/");
      if (isFile) {
        cursor.children.push({ type: "file", name: parts[i], path: segPath });
        continue;
      }
      let dir = cursor.children.find(
        (c): c is TreeDirNode => c.type === "dir" && c.name === parts[i],
      );
      if (!dir) {
        dir = { type: "dir", name: parts[i], path: segPath, children: [] };
        cursor.children.push(dir);
      }
      cursor = dir;
    }
  }

  const sortRec = (node: TreeDirNode) => {
    node.children.sort((a, b) =>
      a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name),
    );
    for (const child of node.children) {
      if (child.type === "dir") sortRec(child);
    }
  };
  sortRec(root);

  return root.children;
}
