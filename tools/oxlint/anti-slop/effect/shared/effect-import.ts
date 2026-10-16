import type { ESTree, SourceCode } from '@oxlint/plugins'
import { resolveVariable } from '../../shared/scope.ts'

function effectSpecifierPath(specifier: ESTree.ImportDeclarationSpecifier): string[] | null {
  const declaration = specifier.parent
  if (declaration?.type !== 'ImportDeclaration' || declaration.importKind === 'type') return null
  const source = declaration.source.value
  if (source !== 'effect' && !source.startsWith('effect/')) return null

  const path = source === 'effect' ? [] : source.slice('effect/'.length).split('/')
  if (specifier.type === 'ImportNamespaceSpecifier') return path
  if (specifier.type !== 'ImportSpecifier' || specifier.importKind === 'type') return null

  const name = specifier.imported.type === 'Identifier'
    ? specifier.imported.name
    : specifier.imported.value
  return [...path, name]
}

export function effectImportPath(
  sourceCode: SourceCode,
  expression: ESTree.Expression | ESTree.ImportSpecifier,
): string[] | null {
  if (expression.type === 'ImportSpecifier') return effectSpecifierPath(expression)
  if (expression.type === 'MemberExpression') {
    const path = effectImportPath(sourceCode, expression.object)
    if (!path) return null

    if (!expression.computed && expression.property.type === 'Identifier')
      return [...path, expression.property.name]
    if (expression.computed && expression.property.type === 'Literal' && typeof expression.property.value === 'string')
      return [...path, expression.property.value]
    return null
  }
  if (expression.type !== 'Identifier') return null

  const variable = resolveVariable(sourceCode, expression)
  for (const definition of variable?.defs ?? []) {
    if (definition.type !== 'ImportBinding') continue
    const specifier = definition.node
    if (specifier.type === 'ImportSpecifier' || specifier.type === 'ImportNamespaceSpecifier' || specifier.type === 'ImportDefaultSpecifier')
      return effectSpecifierPath(specifier)
  }
  return null
}
