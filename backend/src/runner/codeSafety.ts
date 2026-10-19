import ts from 'typescript';

const ALLOWED_MODULES = new Set(['@playwright/test', '@axe-core/playwright']);
const FORBIDDEN_IDENTIFIERS = new Set([
  'process', 'require', 'eval', 'Function', 'globalThis', 'module', '__dirname', '__filename',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'chromium', 'firefox', 'webkit',
]);

const ALLOWED_PLAYWRIGHT_NAMED_IMPORTS = new Set([
  'test', 'expect', 'Page', 'Locator', 'BrowserContext', 'APIRequestContext',
]);

export function findUnsafeConstructs(code: string, filename = 'test.spec.ts'): string[] {
  const source = ts.createSourceFile(filename, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const problems = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (spec && ts.isStringLiteral(spec)) {
        if (!ALLOWED_MODULES.has(spec.text)) {
          problems.add(`Import of "${spec.text}" is not allowed; tests may only import from "@playwright/test".`);
        } else if (spec.text === '@playwright/test') {
          if (!node.importClause) {
            problems.add('Bare imports of "@playwright/test" are not allowed.');
          } else {
            if (node.importClause.name) {
              problems.add('Default imports from "@playwright/test" are not allowed; use: import { test, expect } from "@playwright/test".');
            }
            if (node.importClause.namedBindings) {
              if (ts.isNamespaceImport(node.importClause.namedBindings)) {
                problems.add('Namespace imports from "@playwright/test" are not allowed; use: import { test, expect } from "@playwright/test".');
              } else if (ts.isNamedImports(node.importClause.namedBindings)) {
                for (const element of node.importClause.namedBindings.elements) {
                  const importedName = (element.propertyName ?? element.name).text;
                  if (!ALLOWED_PLAYWRIGHT_NAMED_IMPORTS.has(importedName)) {
                    problems.add(`Importing "${importedName}" from "@playwright/test" is not allowed; only test, expect, and type-only Page/Locator/BrowserContext/APIRequestContext may be imported.`);
                  }
                }
              }
            }
          }
        }
      }
    } else if (ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (spec && ts.isStringLiteral(spec) && !ALLOWED_MODULES.has(spec.text)) {
        problems.add(`Import of "${spec.text}" is not allowed; tests may only import from "@playwright/test".`);
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      problems.add('import = require() is not allowed; use: import { test, expect } from "@playwright/test".');
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        problems.add('Dynamic import() is not allowed in generated tests.');
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'use' &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'test'
      ) {
        problems.add('test.use() is not allowed in generated tests.');
      }
    } else if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const propName = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : null;
      if (propName === 'proxy' || propName === 'launchOptions') {
        problems.add(`Setting "${propName}" is not allowed in generated tests.`);
      }
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
