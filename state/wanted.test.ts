import { describe, expect, it } from 'vitest'
import { isWanted } from './wanted.ts'
import { entry, runStarted, wire } from './testing.ts'

describe('isWanted', () => {
  it('takes the kinds on the list, by name or by family', () => {
    expect(isWanted(runStarted('r1', 0))).toBe(true)
    expect(isWanted(entry('vela.frame.stats', 0, {}))).toBe(true)
    expect(isWanted(entry('phd2.GuideStep', 0, {}))).toBe(true)
    expect(isWanted(entry('command', 0, {}))).toBe(true)
  })

  it('leaves out kinds that are not on the list', () => {
    expect(isWanted(entry('vela.copy.left', 0, {}))).toBe(false)
    expect(isWanted(entry('vela.focus.sample', 0, {}))).toBe(false)
    expect(isWanted(entry('journal', 0, {}))).toBe(false)
  })

  it('takes a device reading only when its property is on the list for that device', () => {
    expect(isWanted(wire('mount', 'EQUATORIAL_EOD_COORD', { RA: 1, DEC: 2 }))).toBe(true)
    expect(isWanted(wire('primary', 'CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: 3 }))).toBe(false)
    expect(isWanted(wire('mount', 'CCD_TEMPERATURE'))).toBe(false)
  })

  it('leaves out a device log line, which has no property', () => {
    expect(isWanted(wire('mount', undefined))).toBe(false)
  })
})
