import { defineRule } from '@oxlint/plugins'
import { effectImportPath } from '../shared/effect-import.ts'

export const noServiceGraphRule = defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Use plain constructors instead of an Effect service graph in app code.' },
    messages: {
      serviceGraph: 'Use plain constructors and visible composition instead of {{member}} in app code.',
    },
  },
  create(context) {
    function check(expression: Parameters<typeof effectImportPath>[1]) {
      const path = effectImportPath(context.sourceCode, expression)
      if (path?.length !== 2) return
      const [module, member] = path
      if (module !== 'Layer' && !(module === 'Context' && (member === 'Service' || member === 'Tag'))) return
      context.report({ node: expression, messageId: 'serviceGraph', data: { member: path.join('.') } })
    }

    return {
      MemberExpression: check,
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier') check(specifier)
        }
      },
    }
  },
})
