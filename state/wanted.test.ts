import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import { isWanted } from './wanted.ts'
import { entry, runStarted, wire } from './testing.ts'

describe('isWanted', () => {
  it('takes the kinds on the list, by name or by family', () => {
    expect(Result.getOrThrow(isWanted(runStarted('r1', 0)))).toBe(true)
    expect(Result.getOrThrow(isWanted(entry('vela.frame.stats', 0, {})))).toBe(true)
    expect(Result.getOrThrow(isWanted(entry('phd2.GuideStep', 0, {})))).toBe(true)
    expect(Result.getOrThrow(isWanted(entry('command', 0, {})))).toBe(true)
  })

  it('leaves out kinds that are not on the list', () => {
    expect(Result.getOrThrow(isWanted(entry('vela.copy.left', 0, {})))).toBe(false)
    expect(Result.getOrThrow(isWanted(entry('vela.focus.sample', 0, {})))).toBe(false)
    expect(Result.getOrThrow(isWanted(entry('journal', 0, {})))).toBe(false)
  })

  it('takes a device reading only when its property is on the list for that device', () => {
    expect(Result.getOrThrow(isWanted(wire('mount', 'EQUATORIAL_EOD_COORD', { RA: 1, DEC: 2 })))).toBe(true)
    expect(Result.getOrThrow(isWanted(wire('primary', 'CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: 3 })))).toBe(false)
    expect(Result.getOrThrow(isWanted(wire('mount', 'CCD_TEMPERATURE')))).toBe(false)
  })

  it('leaves out a device log line, which has no property', () => {
    expect(Result.getOrThrow(isWanted(wire('mount', undefined)))).toBe(false)
  })

  it('fails with a typed MalformedReading for a device reading with no device', () => {
    expect(Result.isFailure(isWanted(entry('wire', 0, { dir: 'in', type: 'set', property: 'P' })))).toBe(true)
  })

  it('takes the removal of a whole device on the list, and leaves out one that is not', () => {
    expect(Result.getOrThrow(isWanted(entry('wire', 0, { dir: 'in', device: 'mount', type: 'del' })))).toBe(true)
    expect(Result.getOrThrow(isWanted(entry('wire', 0, { dir: 'in', device: 'camera2', type: 'del' })))).toBe(false)
  })
})
