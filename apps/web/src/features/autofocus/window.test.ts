import { expect, it } from 'vitest'
import { previewAutofocusWindow } from './window'

it('fits a window around the current FRA position', () => {
  expect(previewAutofocusWindow(32842, 50, 4, 60000)).toEqual({
    fit: true,
    low: 32642,
    high: 33042,
  })
})

it('fits a window that reaches both ends of a reported MinStep and MaxStep', () => {
  expect(previewAutofocusWindow(15700, 50, 4, 38000, 15500)).toEqual({
    fit: true,
    low: 15500,
    high: 15900,
  })
  expect(previewAutofocusWindow(37800, 50, 4, 38000, 15500)).toEqual({
    fit: true,
    low: 37600,
    high: 38000,
  })
  expect(previewAutofocusWindow(15699, 50, 4, 38000, 15500)).toEqual({ fit: false })
  expect(previewAutofocusWindow(37801, 50, 4, 38000, 15500)).toEqual({ fit: false })
  expect(previewAutofocusWindow(15499, 50, 4, 38000, 15500)).toEqual({ fit: false })
})

it('never previews 0 even when a MinStep of 0 is reported', () => {
  expect(previewAutofocusWindow(200, 50, 4, 38000, 0)).toEqual({ fit: false })
  expect(previewAutofocusWindow(250, 50, 4, 38000, 0)).toEqual({ fit: true, low: 50, high: 450 })
})

it('keeps the legacy one-step ceiling when no MinStep is reported', () => {
  expect(previewAutofocusWindow(59800, 50, 4, 60000, null)).toEqual({ fit: false })
  expect(previewAutofocusWindow(59799, 50, 4, 60000, null)).toEqual({
    fit: true,
    low: 59599,
    high: 59999,
  })
})

it('rejects a window that would approach 0 or MaxStep', () => {
  expect(previewAutofocusWindow(80, 50, 4, 60000)).toEqual({ fit: false })
  expect(previewAutofocusWindow(0, 50, 4, 60000)).toEqual({ fit: false })
  expect(previewAutofocusWindow(59820, 50, 4, 60000)).toEqual({ fit: false })
})
