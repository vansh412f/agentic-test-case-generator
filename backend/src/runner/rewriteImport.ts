import ts from 'typescript';

/**
 * Rewrites `@playwright/test` import declarations to a target specifier using the TypeScript AST.
 */
export function rewritePlaywrightImport(code: string, targetSpecifier: string): string {
  const sourceFile = ts.createSourceFile('test.spec.ts', code, ts.ScriptTarget.Latest, true);

  const transformer = <T extends ts.Node>(context: ts.TransformationContext) => {
    return (rootNode: T) => {
      const visit = (node: ts.Node): ts.Node => {
        if (ts.isImportDeclaration(node)) {
          if (
            ts.isStringLiteral(node.moduleSpecifier) &&
            node.moduleSpecifier.text === '@playwright/test'
          ) {
            return context.factory.updateImportDeclaration(
              node,
              node.modifiers,
              node.importClause,
              context.factory.createStringLiteral(targetSpecifier),
              node.assertClause,
            );
          }
        }
        return ts.visitEachChild(node, visit, context);
      };
      return ts.visitNode(rootNode, visit) as T;
    };
  };

  const result = ts.transform(sourceFile, [transformer]);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const transformedSource = result.transformed[0] as ts.SourceFile;
  const newCode = printer.printFile(transformedSource);
  result.dispose();
  return newCode;
}
