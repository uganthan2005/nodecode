// NodeCode JSON Schema (TRD §4) — the intermediate representation shared by
// parser output, PostgreSQL persistence (CanvasState.nodes/edges), and React Flow.

export type EntityType = "FUNCTION" | "CLASS" | "METHOD" | "INTERFACE";

export interface FunctionNodeData {
  fileName: string;
  functionName: string;
  entityType: EntityType;
  parameters: Array<{ name: string; type: string }>;
  returnType: string;
  rawCode: string;
  [key: string]: unknown;
}

export interface ModuleNodeData {
  fileName: string;
  entityCount: number;
  [key: string]: unknown;
}

export interface CanvasNode {
  id: string;
  type: "moduleNode" | "functionNode";
  position: { x: number; y: number };
  data: FunctionNodeData | ModuleNodeData;
  parentId?: string;
  extent?: "parent";
  width?: number;
  height?: number;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  type: "dataFlow";
}

export interface CanvasStateJson {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}
