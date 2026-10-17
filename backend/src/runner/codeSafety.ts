import ts from 'typescript';

const ALLOWED_MODULES = new Set(['@playwright/test']);
const FORBIDDEN_IDENTIFIERS = new Set([
  'process', 'require', 'eval', 'Function', 'globalThis', 'module', '__dirname', '__filename',
]);

export function findUnsafeConstructs(code: string, filename = 'test.spec.ts'): string[] {
  const source = ts.createSourceFile(filename, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const problems = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (spec && ts.isStringLiteral(spec) && !ALLOWED_MODULES.has(spec.text)) {
        problems.add(`Import of "${spec.text}" is not allowed; tests may only import from "@playwright/test".`);
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      problems.add('import = require() is not allowed; use: import { test, expect } from "@playwright/test".');
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      problems.add('Dynamic import() is not allowed in generated tests.');
    } else if (ts.isIdentifier(node) && FORBIDDEN_IDENTIFIERS.has(node.text)) {
      const parent = node.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node);
      if (!isPropertyName) problems.add(`Use of "${node.text}" is not allowed in generated tests.`);
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) &&
      /^\s*file:/i.test(node.text)
    ) {
      problems.add('file: URLs are not allowed; tests may only visit the target application.');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...problems];
}
