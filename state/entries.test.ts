import { Option, Result } from 'effect'
import { describe, expect, it } from 'vitest'
import { readRigEntry } from './entries.ts'
import { entry, frameKept } from './testing.ts'

describe('readRigEntry', () => {
  it('reads a kind the reducers use into its typed shape, leaving out fields they do not', () => {
    const read = readRigEntry(frameKept('m31_001.fits', 1000))

    expect(Result.getOrThrow(read)).toEqual(Option.some(expect.objectContaining({ kind: 'vela.frame', body: { night: '2026-11-08', file: 'm31_001.fits' } })))
  })

  it('passes over kinds no reducer reads', () => {
    expect(Result.getOrThrow(readRigEntry(entry('phd2.Version', 1, { Event: 'Version' })))).toEqual(Option.none())
  })

  it('fails with the entry and the issue when a known kind has the wrong shape', () => {
    const read = readRigEntry(entry('vela.run.ended', 1, { run: 'r1', reason: 'gave up' }))

    expect(Result.isFailure(read)).toBe(true)
    expect(Result.isFailure(read) && read.failure).toMatchObject({ _tag: 'MalformedEntry', kind: 'vela.run.ended' })
  })

  it('reads a run start only with a frame type Vela takes', () => {
    expect(Result.isFailure(readRigEntry(entry('vela.run.started', 1, { run: 'r1', object: 'M 31', frameType: 'twilight', exposureSeconds: 1 })))).toBe(true)
  })

  it('reads a connection change only for the links the rig program reports, with the statuses it sends', () => {
    expect(Result.isSuccess(readRigEntry(entry('client.connection', 1, { target: 'phd2', status: 'failed', error: 'refused' })))).toBe(true)
    expect(Result.isFailure(readRigEntry(entry('client.connection', 1, { target: 'broker', status: 'connected' })))).toBe(true)
    expect(Result.isFailure(readRigEntry(entry('client.connection', 1, { target: 'indiserver', status: 'reconnecting' })))).toBe(true)
  })
})
