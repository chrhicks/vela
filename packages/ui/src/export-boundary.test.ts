import { describe, expect, it } from 'vitest'
import * as stable from './index'
import * as drafts from './drafts'

describe('@vela/ui export boundaries', () => {
  it('exports the complete initial component baseline from the stable root', () => {
    for (const name of [
      'Badge',
      'Button',
      'Checkbox',
      'Dialog',
      'IconButton',
      'Input',
      'Panel',
      'Select',
      'Tabs',
    ]) {
      expect(stable).toHaveProperty(name)
    }
  })

  it('exports the promoted SkyPath primitive from the stable root', () => {
    expect(stable).toHaveProperty('SkyPath')
  })

  it('exports NavigationBar only from the stable root', () => {
    expect(stable).toHaveProperty('NavigationBar')
    expect(drafts).not.toHaveProperty('NavigationBar')
  })

  it('removes promoted components from the draft boundary', () => {
    expect(drafts).not.toHaveProperty('Dialog')
    expect(drafts).not.toHaveProperty('SkyPath')
  })

  it('exports WorkingIndicator only from the stable root', () => {
    expect(stable).toHaveProperty('WorkingIndicator')
    expect(drafts).not.toHaveProperty('WorkingIndicator')
  })
})
