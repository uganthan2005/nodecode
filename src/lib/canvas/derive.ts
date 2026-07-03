import type { Edge, Node } from "@xyflow/react";
import type { EntityType, ModuleNodeData } from "@/lib/canvas/types";

// Semantic zooming (PRD P1): collapsed modules hide their function nodes and
// aggregate entity-level edges up to the module box; type filters (UIUX
// "Filter Layers") hide entity kinds and drop their edges entirely.

export const COLLAPSED_MODULE_HEIGHT = 44;

export function deriveViewGraph(
  rawNodes: Node[],
  rawEdges: Edge[],
  collapsedModules: ReadonlySet<string>,
  hiddenTypes: ReadonlySet<EntityType>,
): { nodes: Node[]; edges: Edge[] } {
  const entityParent = new Map<string, string>();
  for (const node of rawNodes) {
    if (node.type === "functionNode" && node.parentId) {
      entityParent.set(node.id, node.parentId);
    }
  }

  const nodes = rawNodes.map((node) => {
    if (node.type === "moduleNode") {
      const collapsed = collapsedModules.has(node.id);
      return {
        ...node,
        height: collapsed ? COLLAPSED_MODULE_HEIGHT : node.height,
        data: { ...(node.data as ModuleNodeData), collapsed },
      };
    }
    const entityType = node.data.entityType as EntityType;
    const hidden =
      (node.parentId !== undefined && collapsedModules.has(node.parentId)) ||
      hiddenTypes.has(entityType);
    return { ...node, hidden };
  });

  // Resolve each raw edge endpoint: visible entity keeps its id, an entity in
  // a collapsed module promotes to the module id, a type-filtered entity
  // drops the edge.
  const resolveEndpoint = (id: string): string | null => {
    const parent = entityParent.get(id);
    if (parent === undefined) return id; // module-level id already
    const node = rawNodes.find((n) => n.id === id);
    const entityType = node?.data.entityType as EntityType | undefined;
    if (entityType && hiddenTypes.has(entityType)) return null;
    return collapsedModules.has(parent) ? parent : id;
  };

  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (const edge of rawEdges) {
    const source = resolveEndpoint(edge.source);
    const target = resolveEndpoint(edge.target);
    if (!source || !target || source === target) continue;

    const isAggregated = source !== edge.source || target !== edge.target;
    const id = isAggregated ? `agg:${source}->${target}` : edge.id;
    if (seen.has(id)) continue;
    seen.add(id);

    edges.push(
      isAggregated
        ? { ...edge, id, source, target, sourceHandle: null, targetHandle: null }
        : edge,
    );
  }

  return { nodes, edges };
}
