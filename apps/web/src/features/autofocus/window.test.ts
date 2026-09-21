import { expect, it } from 'vitest'
import { previewAutofocusWindow } from './window'

it('fits a window around the current FRA position', () => {
  expect(previewAutofocusWindow(32842, 50, 4, 60000)).toEqual({
    fit: true,
    low: 32642,
    high: 33042,
  })
})

it('rejects a window that would approach 0 or MaxStep', () => {
  expect(previewAutofocusWindow(80, 50, 4, 60000)).toEqual({ fit: false })
  expect(previewAutofocusWindow(0, 50, 4, 60000)).toEqual({ fit: false })
  expect(previewAutofocusWindow(59820, 50, 4, 60000)).toEqual({ fit: false })
})
