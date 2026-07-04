import type {
  CanvasEdge,
  CanvasNode,
  CanvasStateJson,
} from "@/lib/canvas/types";
import type { ParsedModule } from "@/lib/ingest/parser";

// Transforms the parsed entity catalog into the CanvasState JSON (TRD §4):
// one group node per file (Module Node) containing its Function Nodes,
// plus dataFlow edges resolved from the collected call names.

const NODE_WIDTH = 240;
const NODE_HEIGHT = 72;
const NODE_GAP = 12;
const MODULE_PADDING = 16;
const MODULE_HEADER = 44;
const MODULE_GAP_X = 96;
const MODULE_GAP_Y = 72;
const MODULES_PER_ROW = 4;

export function moduleNodeId(filePath: string): string {
  return `mod:${filePath}`;
}

/**
 * Rebuilt graphs keep the user's spatial arrangement: nodes that survived a
 * mutation retain their previous position (renamed entities carry theirs
 * over via renameMap); genuinely new nodes keep the computed layout spot.
 */
export function mergeNodePositions(
  previous: Array<Pick<CanvasNode, "id" | "position">>,
  next: CanvasNode[],
  renameMap?: ReadonlyMap<string, string>,
): CanvasNode[] {
  const previousPositions = new Map(previous.map((n) => [n.id, n.position]));
  if (renameMap) {
    for (const [oldId, newId] of renameMap) {
      const position = previousPositions.get(oldId);
      if (position) previousPositions.set(newId, position);
    }
  }
  return next.map((node) => {
    const position = previousPositions.get(node.id);
    return position ? { ...node, position } : node;
  });
}

export function entityNodeId(filePath: string, name: string): string {
  return `fn:${filePath}#${name}`;
}

export function buildCanvasState(modules: ParsedModule[]): CanvasStateJson {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  // name -> node ids, used to resolve call names into edges
  const entityIndex = new Map<string, string[]>();
  for (const module of modules) {
    for (const entity of module.entities) {
      const id = entityNodeId(module.filePath, entity.name);
      const simpleName = entity.name.includes(".")
        ? entity.name.split(".").pop()!
        : entity.name;
      for (const key of new Set([entity.name, simpleName])) {
        entityIndex.set(key, [...(entityIndex.get(key) ?? []), id]);
      }
    }
  }

  // Lay modules out in a fixed-column grid; row height tracks the tallest module
  let rowY = 0;
  let rowMaxHeight = 0;
  modules.forEach((module, index) => {
    const column = index % MODULES_PER_ROW;
    if (column === 0 && index > 0) {
      rowY += rowMaxHeight + MODULE_GAP_Y;
      rowMaxHeight = 0;
    }

    const moduleWidth = NODE_WIDTH + MODULE_PADDING * 2;
    const moduleHeight =
      MODULE_HEADER +
      MODULE_PADDING +
      module.entities.length * (NODE_HEIGHT + NODE_GAP);
    rowMaxHeight = Math.max(rowMaxHeight, moduleHeight);

    nodes.push({
      id: moduleNodeId(module.filePath),
      type: "moduleNode",
      position: { x: column * (moduleWidth + MODULE_GAP_X), y: rowY },
      data: { fileName: module.filePath, entityCount: module.entities.length },
      width: moduleWidth,
      height: moduleHeight,
    });

    module.entities.forEach((entity, entityIndexInModule) => {
      nodes.push({
        id: entityNodeId(module.filePath, entity.name),
        type: "functionNode",
        position: {
          x: MODULE_PADDING,
          y: MODULE_HEADER + entityIndexInModule * (NODE_HEIGHT + NODE_GAP),
        },
        parentId: moduleNodeId(module.filePath),
        extent: "parent",
        width: NODE_WIDTH,
        data: {
          fileName: module.filePath,
          functionName: entity.name,
          entityType: entity.type,
          parameters: entity.parameters,
          returnType: entity.returnType,
          rawCode: entity.rawCode,
        },
      });
    });
  });

  // Resolve calls into edges. Ambiguous names prefer a same-file target;
  // multi-match names across files are skipped to avoid false edges.
  const seenEdges = new Set<string>();
  for (const module of modules) {
    for (const entity of module.entities) {
      const sourceId = entityNodeId(module.filePath, entity.name);
      for (const callee of entity.calls) {
        const candidates = entityIndex.get(callee) ?? [];
        let targetId: string | undefined;
        if (candidates.length === 1) {
          targetId = candidates[0];
        } else if (candidates.length > 1) {
          targetId = candidates.find((id) => id.startsWith(`fn:${module.filePath}#`));
        }
        if (!targetId || targetId === sourceId) continue;

        const edgeId = `edge:${sourceId}->${targetId}`;
        if (seenEdges.has(edgeId)) continue;
        seenEdges.add(edgeId);
        edges.push({ id: edgeId, source: sourceId, target: targetId, type: "dataFlow" });
      }
    }
  }

  return { nodes, edges };
}
