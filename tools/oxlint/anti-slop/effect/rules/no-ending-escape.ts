import { defineRule } from '@oxlint/plugins'
import { effectImportPath } from '../shared/effect-import.ts'

const endingEscape = /^(?:catch|ignore|orElse|match|timeout|race|retry|mapError|sandbox|fork|run)|^(?:option|exit|result|mapBoth|flip)$/u

export const noEndingEscapeRule = defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Keep physical operation endings intact in workflows and jobs.' },
    messages: {
      endingEscape: 'Effect.{{member}} can change or detach an operation ending. Carry the ending through this workflow; settle it at the rig or adapter boundary.',
    },
  },
  create(context) {
    function check(expression: Parameters<typeof effectImportPath>[1]) {
      const path = effectImportPath(context.sourceCode, expression)
      const member = path?.[1]
      if (path?.length !== 2 || path[0] !== 'Effect' || !member || !endingEscape.test(member)) return
      context.report({ node: expression, messageId: 'endingEscape', data: { member } })
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
