import { describe, expect, it } from 'vitest'
import * as stable from './index'
import * as drafts from './drafts'

describe('@vela/ui export boundaries', () => {
  it('exports the complete initial component baseline from the stable root', () => {
    for (const name of ['Badge', 'Button', 'Checkbox', 'IconButton', 'Input', 'Panel', 'Select', 'Tabs']) {
      expect(stable).toHaveProperty(name)
      expect(stable[name as keyof typeof stable]).toBeTypeOf('function')
    }
  })

  it('keeps the draft export surface empty after baseline promotion', () => {
    expect(Object.keys(drafts)).toEqual([])
  })
})
