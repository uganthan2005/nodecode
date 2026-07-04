import { Project, type Node, type SourceFile } from "ts-morph";
import type { SyncDiagnostic } from "@/lib/canvas/patches";
import { entitySpan, entitySpanNode } from "@/lib/ingest/parser";

// The Reverse Engine (TRD §3): receives a JSON patch, locates the exact
// declaration in the module's working copy, mutates the AST, and validates
// that the result still forms a valid tree. Invalid syntax rejects the whole
// mutation — the stored source is never corrupted (App Flow §4).
//
// Mutations operate on the comment-inclusive entity span (entitySpan), the
// same span the parser serves as rawCode — the editor buffer round-trips
// byte-for-byte.

export type MutationResult =
  | { ok: true; newSource: string }
  | { ok: false; diagnostics: SyncDiagnostic[] }
  | { ok: false; notFound: true };

function findEntity(
  sourceFile: SourceFile,
  entityName: string,
): Node | undefined {
  // Methods are catalogued as "ClassName.methodName" (graph.ts naming)
  const dotIndex = entityName.indexOf(".");
  if (dotIndex !== -1) {
    const className = entityName.slice(0, dotIndex);
    const methodName = entityName.slice(dotIndex + 1);
    return sourceFile.getClass(className)?.getMethod(methodName);
  }
  return (
    sourceFile.getFunction(entityName) ??
    sourceFile.getVariableDeclaration(entityName) ??
    sourceFile.getClass(entityName) ??
    sourceFile.getInterface(entityName)
  );
}

function collectSyntaxDiagnostics(
  project: Project,
  sourceFile: SourceFile,
  /** Line the edited block starts at — maps file positions back to the editor buffer */
  blockStartLine: number,
  blockLineCount: number,
): SyncDiagnostic[] {
  return project
    .getProgram()
    .getSyntacticDiagnostics(sourceFile)
    .map((diagnostic) => {
      const fileLine = diagnostic.getLineNumber() ?? 1;
      const relative = fileLine - blockStartLine + 1;
      const messageText = diagnostic.getMessageText();
      return {
        line: Math.min(Math.max(relative, 1), Math.max(blockLineCount, 1)),
        column: 1,
        message:
          typeof messageText === "string"
            ? messageText
            : messageText.getMessageText(),
      };
    });
}

function inMemoryFile(filePath: string, source: string) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { allowJs: true },
  });
  return { project, sourceFile: project.createSourceFile(filePath, source) };
}

export function replaceEntityCode(
  filePath: string,
  source: string,
  entityName: string,
  newCode: string,
): MutationResult {
  const { project, sourceFile } = inMemoryFile(filePath, source);
  const entity = findEntity(sourceFile, entityName);
  if (!entity) return { ok: false, notFound: true };

  const spanNode = entitySpanNode(entity);
  const { start, end } = entitySpan(spanNode);
  const blockStartLine = sourceFile.getLineAndColumnAtPos(start).line;

  sourceFile.replaceText([start, end], newCode);

  const diagnostics = collectSyntaxDiagnostics(
    project,
    sourceFile,
    blockStartLine,
    newCode.split("\n").length,
  );
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return { ok: true, newSource: sourceFile.getFullText() };
}

export function removeEntity(
  filePath: string,
  source: string,
  entityName: string,
): MutationResult {
  const { project, sourceFile } = inMemoryFile(filePath, source);
  const entity = findEntity(sourceFile, entityName);
  if (!entity) return { ok: false, notFound: true };

  // Splice out the whole span — declaration plus its leading comments
  const { start, end } = entitySpan(entitySpanNode(entity));
  sourceFile.replaceText([start, end], "");

  // Removal should never break syntax, but never persist without proof
  const diagnostics = collectSyntaxDiagnostics(project, sourceFile, 1, 1);
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return { ok: true, newSource: sourceFile.getFullText() };
}
