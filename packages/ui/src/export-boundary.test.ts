import { describe, expect, it } from 'vitest'
import * as stable from './index'
import * as drafts from './drafts'

describe('@vela/ui export boundaries', () => {
  it('exports the complete initial component baseline from the stable root', () => {
    for (const name of ['Badge', 'Button', 'Checkbox', 'Dialog', 'IconButton', 'Input', 'Panel', 'Select', 'Tabs']) {
      expect(stable).toHaveProperty(name)
    }
  })

  it('removes promoted components from the draft boundary', () => {
    expect(drafts).not.toHaveProperty('Dialog')
  })
})
