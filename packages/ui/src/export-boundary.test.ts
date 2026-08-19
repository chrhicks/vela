import { describe, expect, it } from 'vitest'
import * as stable from './index'
import * as drafts from './drafts'

describe('@vela/ui export boundaries', () => {
  it('exports promoted Button from the stable root', () => {
    expect(stable.Button).toBeTypeOf('function')
  })

  it('does not expose Button or other draft components from the draft boundary incorrectly', () => {
    expect(drafts).not.toHaveProperty('Button')
    expect(stable).not.toHaveProperty('Input')
    expect(stable).not.toHaveProperty('Panel')
    expect(drafts.Input).toBeTypeOf('function')
    expect(drafts.Panel).toBeTypeOf('function')
  })
})
