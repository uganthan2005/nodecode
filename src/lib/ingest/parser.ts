import { createHash } from "node:crypto";
import path from "node:path";
import { Node, Project, type SourceFile } from "ts-morph";
import type { EntityType } from "@/lib/canvas/types";

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

function parseSourceFile(file: SourceFile, rootDir: string): ParsedModule {
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
      rawCode: clampCode(fn.getText()),
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
      rawCode: clampCode(decl.getText()),
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
      rawCode: clampCode(cls.getText()),
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
        rawCode: clampCode(method.getText()),
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
      rawCode: clampCode(iface.getText()),
      calls: [],
    });
  }

  const fullText = file.getFullText();
  return {
    filePath: path.relative(rootDir, file.getFilePath()).replaceAll("\\", "/"),
    hash: createHash("sha256").update(fullText).digest("hex"),
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
    .map((file) => parseSourceFile(file, rootDir))
    .filter((module) => module.entities.length > 0);

  return { modules, truncated };
}
