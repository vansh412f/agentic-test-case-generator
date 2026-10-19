import ts from 'typescript';

const ALLOWED_MODULES = new Set(['@playwright/test', '@axe-core/playwright']);

const FORBIDDEN_NAMES = new Set([
  'constructor',
  'prototype',
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'caller',
  'callee',
  'arguments',
]);

const FORBIDDEN_IDENTIFIERS = new Set([
  'process', 'require', 'eval', 'Function', 'globalThis', 'module', '__dirname', '__filename',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'chromium', 'firefox', 'webkit',
  'playwright', 'browser', 'browserType', 'browserName', 'launchOptions', 'connectOptions',
  // Rules b additions:
  'Reflect', 'Proxy', 'Object', 'Symbol', 'WebAssembly', 'SharedArrayBuffer', 'Atomics',
  'WeakRef', 'FinalizationRegistry', 'setInterval',
]);

const ALLOWED_PLAYWRIGHT_NAMED_IMPORTS = new Set([
  'test', 'expect', 'Page', 'Locator', 'BrowserContext', 'APIRequestContext',
]);

const ALLOWED_FIXTURES = new Set(['page', 'request', 'context']);

const FORBIDDEN_PROPERTY_NAMES = new Set([
  'launch', 'launchPersistentContext', 'launchServer', 'connect', 'connectOverCDP',
  'browserType', 'browser', 'newBrowserCDPSession', 'route', 'routeFromHAR', 'unroute',
  'setExtraHTTPHeaders', 'addInitScript', 'exposeFunction', 'exposeBinding',
  // Rules c additions:
  'info', 'attach', 'newCDPSession', 'tracing', 'storageState', 'saveAs', 'pdf',
  'addScriptTag', 'addStyleTag', 'video', 'setFiles',
]);

const TEST_RUNNER_METHODS = new Set([
  'describe', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'step',
  'only', 'skip', 'fixme', 'fail', 'slow',
]);

function isTestRunnerCall(expr: ts.Expression): boolean {
  if (ts.isIdentifier(expr)) {
    return expr.text === 'test';
  }
  if (ts.isPropertyAccessExpression(expr)) {
    if (TEST_RUNNER_METHODS.has(expr.name.text)) {
      return isTestRunnerCall(expr.expression);
    }
  }
  return false;
}

function getFirstSegment(expr: ts.Expression): string | null {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }
  if (ts.isTemplateExpression(expr)) {
    return expr.head.text;
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return getFirstSegment(expr.left);
  }
  return null;
}

export function findUnsafeConstructs(code: string, filename = 'test.spec.ts'): string[] {
  const source = ts.createSourceFile(filename, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const problems = new Set<string>();

  const checkTestCallbackParameters = (fn: ts.FunctionExpression | ts.ArrowFunction): void => {
    if (fn.parameters.length === 0) return;
    const firstParam = fn.parameters[0];
    if (!ts.isObjectBindingPattern(firstParam.name)) {
      problems.add(
        `Test callback first parameter must be destructured ({ page, request, context }); received non-destructured parameter "${firstParam.name.getText(source)}".`,
      );
      return;
    }

    for (const elem of firstParam.name.elements) {
      if (elem.dotDotDotToken) {
        problems.add('Rest elements in test callback parameters are not allowed.');
        continue;
      }
      const binding = elem.propertyName ?? elem.name;
      if (!ts.isIdentifier(binding)) {
        problems.add('Non-identifier bindings in test callback parameters are not allowed.');
        continue;
      }
      if (!ALLOWED_FIXTURES.has(binding.text)) {
        problems.add(
          `Fixture "${binding.text}" is not allowed; test callbacks may only bind { page, request, context }.`,
        );
      }
    }
  };

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

      // Check setTimeout with string argument
      if (ts.isIdentifier(node.expression) && node.expression.text === 'setTimeout') {
        if (node.arguments.length > 0) {
          const firstArg = node.arguments[0];
          if (
            ts.isStringLiteral(firstArg) ||
            ts.isNoSubstitutionTemplateLiteral(firstArg) ||
            ts.isTemplateExpression(firstArg) ||
            ts.isBinaryExpression(firstArg)
          ) {
            problems.add('setTimeout with a string argument is not allowed in generated tests.');
          }
        }
      }

      // Check waitForEvent('download' | 'filechooser')
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'waitForEvent'
      ) {
        if (node.arguments.length > 0) {
          const firstArg = node.arguments[0];
          if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
            if (firstArg.text === 'download' || firstArg.text === 'filechooser') {
              problems.add(`waitForEvent('${firstArg.text}') is not allowed in generated tests.`);
            }
          }
        }
      }

      // Check setInputFiles: first argument must be an object literal or an array literal of object literals
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'setInputFiles'
      ) {
        const firstArg = node.arguments[0];
        let valid = false;
        if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
          valid = true;
        } else if (firstArg && ts.isArrayLiteralExpression(firstArg)) {
          if (firstArg.elements.length > 0 && firstArg.elements.every((el) => ts.isObjectLiteralExpression(el))) {
            valid = true;
          }
        }
        if (!valid) {
          problems.add(
            'setInputFiles: first argument must be an object literal or an array literal of object literals',
          );
        }
      }

      // Check page.goto / frame.goto
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'goto'
      ) {
        const firstArg = node.arguments[0];
        if (!firstArg) {
          problems.add('goto target must start with http:// or https://');
        } else if (ts.isStringLiteral(firstArg)) {
          if (/^\s*file:/i.test(firstArg.text)) {
            problems.add('file: URLs are not allowed; tests may only visit the target application.');
          }
        } else {
          const firstSegment = getFirstSegment(firstArg);
          if (
            !firstSegment ||
            (!firstSegment.startsWith('http://') && !firstSegment.startsWith('https://'))
          ) {
            problems.add('goto target must start with http:// or https://');
          }
        }
      }

      // Check test(), test.describe(), test.beforeEach(), etc. callbacks
      if (isTestRunnerCall(node.expression)) {
        for (const arg of node.arguments) {
          if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
            checkTestCallbackParameters(arg);
          }
        }
      }
    } else if (ts.isPropertyAccessExpression(node)) {
      const propName = node.name.text;
      if (FORBIDDEN_PROPERTY_NAMES.has(propName)) {
        problems.add(`Access to property "${propName}" is not allowed.`);
      } else if (propName.startsWith('_')) {
        problems.add(`Access to private property "${propName}" is not allowed.`);
      }
    } else if (ts.isElementAccessExpression(node)) {
      if (!ts.isNumericLiteral(node.argumentExpression)) {
        problems.add('Element access with non-numeric argument is not allowed; computed property lookup is prohibited.');
      }
    } else if (ts.isComputedPropertyName(node)) {
      problems.add('Computed property names in object literals are not allowed.');
    } else if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const propName = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : null;
      if (propName === 'proxy' || propName === 'launchOptions') {
        problems.add(`Setting "${propName}" is not allowed in generated tests.`);
      } else if (propName === 'path') {
        problems.add('Property "path" in object literals is not allowed.');
      } else if (propName && propName.startsWith('_')) {
        problems.add(`Property "${propName}" starting with "_" is not allowed.`);
      }
    } else if (ts.isIdentifier(node)) {
      if (FORBIDDEN_NAMES.has(node.text)) {
        problems.add(`Use of "${node.text}" is not allowed in generated tests.`);
      } else if (FORBIDDEN_IDENTIFIERS.has(node.text)) {
        const parent = node.parent;
        const isPropertyName =
          (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          (ts.isPropertyAssignment(parent) && parent.name === node);
        if (!isPropertyName) problems.add(`Use of "${node.text}" is not allowed in generated tests.`);
      }
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node)
    ) {
      if (FORBIDDEN_NAMES.has(node.text)) {
        problems.add(`Use of "${node.text}" is not allowed in generated tests.`);
      } else if (/^\s*file:/i.test(node.text)) {
        problems.add('file: URLs are not allowed; tests may only visit the target application.');
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return [...problems];
}
