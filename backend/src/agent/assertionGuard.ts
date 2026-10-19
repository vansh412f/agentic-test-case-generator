import ts from 'typescript';

const LOCATORS = new Set([
  'locator', 'getByTestId', 'getByRole', 'getByPlaceholder', 'getByLabel',
  'getByText', 'getByAltText', 'getByTitle', 'filter', 'first', 'last', 'nth',
  'and', 'or', 'frameLocator',
]);

function canonicalize(code: string, enforceAwait: boolean): string | null {
  const diagnostics = ts.transpileModule(code, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).diagnostics;
  if (diagnostics?.some((d) => d.category === ts.DiagnosticCategory.Error)) return null;

  const source = ts.createSourceFile('guard.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const locatorNames = new Set<string>();
  let validImports = false;
  let invalid = false;
  let assertions = 0;
  const assertionContracts: string[] = [];
  const initializers = new Map<string, ts.Expression[]>();
  const printer = ts.createPrinter({ removeComments: true });
  const print = (node: ts.Node) => printer.printNode(ts.EmitHint.Unspecified, node, source);

  function collectBindings(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      initializers.set(node.name.text, [...(initializers.get(node.name.text) ?? []), node.initializer]);
    }
    ts.forEachChild(node, collectBindings);
  }
  collectBindings(source);

  function fingerprint(node: ts.Node, textOnly: boolean): string[] {
    const values: string[] = [];
    const seen = new Set<string>();
    function scan(current: ts.Node): void {
      if (textOnly && ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression) &&
          current.expression.name.text === 'getByText') values.push(print(current));
      if (ts.isIdentifier(current) && !seen.has(current.text)) {
        seen.add(current.text);
        for (const initializer of initializers.get(current.text) ?? []) {
          if (!textOnly) values.push(print(initializer));
          scan(initializer);
        }
      }
      ts.forEachChild(current, scan);
    }
    if (!textOnly) values.push(print(node));
    scan(node);
    return values;
  }

  function assertionContract(root: ts.CallExpression): string {
    const parts = root.arguments[0] ? fingerprint(root.arguments[0], true) : [];
    let outer: ts.Node = root;
    while ((ts.isPropertyAccessExpression(outer.parent) && outer.parent.expression === outer) ||
           (ts.isCallExpression(outer.parent) && outer.parent.expression === outer)) {
      outer = outer.parent;
      if (ts.isCallExpression(outer)) {
        parts.push(...outer.arguments.flatMap((argument) => fingerprint(argument, false)));
      }
    }
    return JSON.stringify(parts);
  }

  function inertArgument(node: ts.Node): boolean {
    if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node) ||
        ts.isRegularExpressionLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ||
        node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword ||
        node.kind === ts.SyntaxKind.NullKeyword) return true;
    if (ts.isObjectLiteralExpression(node)) return node.properties.every((property) =>
      ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name) &&
      inertArgument(property.initializer));
    if (ts.isArrayLiteralExpression(node)) return node.elements.every(inertArgument);
    return false;
  }

  function isLocator(node: ts.Node): boolean {
    if (ts.isIdentifier(node)) return locatorNames.has(node.text);
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
    const { expression: receiver, name } = node.expression;
    return LOCATORS.has(name.text) && node.arguments.every(inertArgument) &&
      ((ts.isIdentifier(receiver) && receiver.text === 'page') || isLocator(receiver));
  }

  function isAssertionCall(node: ts.Node): boolean {
    if (!ts.isCallExpression(node)) return false;
    if (ts.isIdentifier(node.expression)) return node.expression.text === 'expect';
    return ts.isPropertyAccessExpression(node.expression) && isAssertionReceiver(node.expression.expression);
  }

  function isAssertionReceiver(node: ts.Node): boolean {
    return isAssertionCall(node) ||
      (ts.isPropertyAccessExpression(node) && isAssertionReceiver(node.expression));
  }

  function isAsyncOperation(node: ts.Node): boolean {
    if (isAssertionCall(node)) return true;
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
    const { expression: receiver, name } = node.expression;
    return ['goto', 'click', 'fill', 'selectOption', 'hover', 'press', 'check', 'uncheck',
      'waitForLoadState', 'waitForSelector', 'scrollIntoViewIfNeeded'].includes(name.text) &&
      ((ts.isIdentifier(receiver) && receiver.text === 'page') || isLocator(receiver));
  }

  function inspect(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === '@playwright/test') {
      const bindings = node.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings) || node.importClause?.name) {
        invalid = true;
      } else {
        const names = bindings.elements.map((e) => e.name.text);
        validImports = names.includes('test') && names.includes('expect');
        if (bindings.elements.some((e) => e.propertyName || e.isTypeOnly)) invalid = true;
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
        node.initializer && isLocator(node.initializer)) locatorNames.add(node.name.text);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        node.expression.text === 'expect') {
      assertions++;
      assertionContracts.push(assertionContract(node));
    }
    if (enforceAwait && isAsyncOperation(node)) {
      let outer = node;
      while ((ts.isPropertyAccessExpression(outer.parent) && outer.parent.expression === outer) ||
             (ts.isCallExpression(outer.parent) && outer.parent.expression === outer)) outer = outer.parent;
      if (!ts.isAwaitExpression(outer.parent)) invalid = true;
    }
    ts.forEachChild(node, inspect);
  }
  inspect(source);
  if (!validImports || invalid || assertions === 0) return null;

  function optionalWait(node: ts.Expression): boolean {
    const expression = ts.isAwaitExpression(node) ? node.expression : node;
    if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) return false;
    const { expression: receiver, name } = expression.expression;
    if (!expression.arguments.every(inertArgument)) return false;
    return (ts.isIdentifier(receiver) && receiver.text === 'page' &&
      ['waitForLoadState', 'waitForSelector'].includes(name.text)) ||
      (isLocator(receiver) && name.text === 'scrollIntoViewIfNeeded');
  }

  const transformed = ts.transform(source, [(context) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isExpressionStatement(node) && optionalWait(node.expression)) return undefined;
      if (ts.isAwaitExpression(node) && isAsyncOperation(node.expression)) return ts.visitNode(node.expression, visit);
      if (ts.isCallExpression(node) && isLocator(node)) return ts.factory.createIdentifier('__guard_locator__');
      return ts.visitEachChild(node, visit, context);
    };
    return (node) => ts.visitEachChild(node, visit, context);
  }]);
  try {
    const result = transformed.transformed[0];
    return result ? `${assertions}:${JSON.stringify(assertionContracts)}:` + printer.printFile(result) : null;
  } finally {
    transformed.dispose();
  }
}

export function correctionPreservesAssertions(before: string, after: string): boolean {
  try {
    const original = canonicalize(before, false);
    return original !== null && original === canonicalize(after, true);
  } catch {
    return false;
  }
}

const SECRET_TOKEN_REGEX = /__AGT_SECRET_\d+__/g;

export function correctionPreservesSecrets(prev: string, next: string): boolean {
  const prevTokens = prev.match(SECRET_TOKEN_REGEX);
  if (!prevTokens || prevTokens.length === 0) return true;
  for (const token of prevTokens) {
    if (!next.includes(token)) {
      return false;
    }
  }
  return true;
}

// Module component implementation.
