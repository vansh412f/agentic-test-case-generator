import ts from 'typescript';

/**
 * Rewrites `@playwright/test` import and export declarations to a target specifier using text splicing.
 * Output is byte-identical to original code except for the replaced module specifier string literals.
 */
export function rewritePlaywrightImport(code: string, targetSpecifier: string): string {
  const sf = ts.createSourceFile('test.spec.ts', code, ts.ScriptTarget.Latest, true);

  const specs: ts.StringLiteral[] = [];

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      if (
        ts.isStringLiteral(stmt.moduleSpecifier) &&
        stmt.moduleSpecifier.text === '@playwright/test'
      ) {
        specs.push(stmt.moduleSpecifier);
      }
    } else if (ts.isExportDeclaration(stmt)) {
      if (
        stmt.moduleSpecifier &&
        ts.isStringLiteral(stmt.moduleSpecifier) &&
        stmt.moduleSpecifier.text === '@playwright/test'
      ) {
        specs.push(stmt.moduleSpecifier);
      }
    }
  }

  if (specs.length === 0) {
    return code;
  }

  // Sort in reverse order of start position so splicing later offsets does not shift earlier offsets
  specs.sort((a, b) => b.getStart(sf) - a.getStart(sf));

  let result = code;
  const replacement = JSON.stringify(targetSpecifier);

  for (const spec of specs) {
    result = result.slice(0, spec.getStart(sf)) + replacement + result.slice(spec.getEnd());
  }

  return result;
}
