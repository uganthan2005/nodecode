import { createHash } from "node:crypto";
import path from "node:path";
import { Node, Project, type SourceFile } from "ts-morph";
import type { EntityType } from "@/lib/canvas/types";

/**
 * The text span of an entity INCLUDING its leading comments/JSDoc. The
 * reverse engine replaces exactly this span, so what the editor shows is
 * byte-for-byte what a save overwrites — no comment loss or duplication.
 */
export function entitySpan(node: Node): { start: number; end: number } {
  const comments = node.getLeadingCommentRanges();
  const start = comments.length > 0 ? comments[0].getPos() : node.getStart(true);
  return { start, end: node.getEnd() };
}

/**
 * Arrow functions catalogued by variable name edit as their whole statement
 * (`const parse = ...`), not the bare declaration fragment.
 */
export function entitySpanNode(node: Node): Node {
  if (Node.isVariableDeclaration(node)) {
    const statement = node.getVariableStatement();
    if (statement && statement.getDeclarations().length === 1) {
      return statement;
    }
  }
  return node;
}

function spanText(node: Node): string {
  const spanNode = entitySpanNode(node);
  const { start, end } = entitySpan(spanNode);
  return spanNode.getSourceFile().getFullText().slice(start, end);
}

// The Ingestion Pipeline (TRD §3): walk every .ts/.tsx source file with
// ts-morph and reduce it to a clean, declarative entity catalog.

export interface ParsedEntity {
  name: string;
  type: EntityType;
  parameters: Array<{ name: string; type: string }>;
  returnType: string;
  startLine: number;
  endLine: number;
  rawCode: string;
  /** Simple callee names found inside the body — resolved into edges later */
  calls: string[];
}

export interface ParsedModule {
  filePath: string;
  hash: string;
  /** Current full text of the file — persisted as the durable working copy */
  source: string;
  entities: ParsedEntity[];
}

export interface ParseResult {
  modules: ParsedModule[];
  truncated: boolean;
}

/** PRD targets repos under 50 files; hard cap keeps the MVP parser bounded. */
const MAX_FILES = 300;
const MAX_RAW_CODE_CHARS = 20_000;

function collectCalls(body: Node): string[] {
  const calls = new Set<string>();
  body.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const expression = node.getExpression();
    if (Node.isIdentifier(expression)) {
      calls.add(expression.getText());
    } else if (Node.isPropertyAccessExpression(expression)) {
      calls.add(expression.getName());
    }
  });
  return [...calls];
}

function parameterList(
  node: { getParameters(): Array<{ getName(): string; getTypeNode(): Node | undefined }> },
): Array<{ name: string; type: string }> {
  return node.getParameters().map((p) => ({
    name: p.getName(),
    type: p.getTypeNode()?.getText() ?? "unknown",
  }));
}

function clampCode(text: string): string {
  return text.length > MAX_RAW_CODE_CHARS
    ? `${text.slice(0, MAX_RAW_CODE_CHARS)}\n// … truncated by NodeCode parser`
    : text;
}

function parseSourceFile(file: SourceFile, filePath: string): ParsedModule {
  const entities: ParsedEntity[] = [];

  // Plain function declarations
  for (const fn of file.getFunctions()) {
    const name = fn.getName();
    if (!name) continue; // anonymous default exports have no graph identity yet
    entities.push({
      name,
      type: "FUNCTION",
      parameters: parameterList(fn),
      returnType: fn.getReturnTypeNode()?.getText() ?? fn.getReturnType().getText(fn),
      startLine: fn.getStartLineNumber(),
      endLine: fn.getEndLineNumber(),
      rawCode: clampCode(spanText(fn)),
      calls: collectCalls(fn),
    });
  }

  // Arrow functions / function expressions bound to variables
  for (const decl of file.getVariableDeclarations()) {
    const initializer = decl.getInitializer();
    if (
      !initializer ||
      (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer))
    ) {
      continue;
    }
    entities.push({
      name: decl.getName(),
      type: "FUNCTION",
      parameters: parameterList(initializer),
      returnType:
        initializer.getReturnTypeNode()?.getText() ??
        initializer.getReturnType().getText(initializer),
      startLine: decl.getStartLineNumber(),
      endLine: decl.getEndLineNumber(),
      rawCode: clampCode(spanText(decl)),
      calls: collectCalls(initializer),
    });
  }

  // Classes and their methods
  for (const cls of file.getClasses()) {
    const className = cls.getName();
    if (!className) continue;
    entities.push({
      name: className,
      type: "CLASS",
      parameters: [],
      returnType: className,
      startLine: cls.getStartLineNumber(),
      endLine: cls.getEndLineNumber(),
      rawCode: clampCode(spanText(cls)),
      calls: [],
    });
    for (const method of cls.getMethods()) {
      entities.push({
        name: `${className}.${method.getName()}`,
        type: "METHOD",
        parameters: parameterList(method),
        returnType:
          method.getReturnTypeNode()?.getText() ?? method.getReturnType().getText(method),
        startLine: method.getStartLineNumber(),
        endLine: method.getEndLineNumber(),
        rawCode: clampCode(spanText(method)),
        calls: collectCalls(method),
      });
    }
  }

  // Interfaces
  for (const iface of file.getInterfaces()) {
    entities.push({
      name: iface.getName(),
      type: "INTERFACE",
      parameters: [],
      returnType: iface.getName(),
      startLine: iface.getStartLineNumber(),
      endLine: iface.getEndLineNumber(),
      rawCode: clampCode(spanText(iface)),
      calls: [],
    });
  }

  const fullText = file.getFullText();
  return {
    filePath,
    hash: createHash("sha256").update(fullText).digest("hex"),
    source: fullText,
    entities,
  };
}

export function parseRepository(rootDir: string): ParseResult {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true },
  });

  const normalizedRoot = rootDir.replaceAll("\\", "/");
  project.addSourceFilesAtPaths([
    `${normalizedRoot}/**/*.{ts,tsx}`,
    `!${normalizedRoot}/**/node_modules/**`,
    `!${normalizedRoot}/**/*.d.ts`,
  ]);

  let files = project
    .getSourceFiles()
    .sort((a, b) => a.getFilePath().localeCompare(b.getFilePath()));
  const truncated = files.length > MAX_FILES;
  if (truncated) files = files.slice(0, MAX_FILES);

  const modules = files
    .map((file) =>
      parseSourceFile(
        file,
        path.relative(rootDir, file.getFilePath()).replaceAll("\\", "/"),
      ),
    )
    .filter((module) => module.entities.length > 0);

  return { modules, truncated };
}

/**
 * Parses in-memory sources (the DB working copies) — used by the reverse
 * engine to rebuild the graph after a code mutation without touching disk.
 * Modules left with zero entities are dropped from the graph but their DB
 * rows (and source text) survive.
 */
export function parseSources(
  sources: Array<{ filePath: string; source: string }>,
): ParsedModule[] {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { allowJs: true },
  });
  return sources
    .map(({ filePath, source }) =>
      parseSourceFile(project.createSourceFile(filePath, source), filePath),
    )
    .filter((module) => module.entities.length > 0);
}
