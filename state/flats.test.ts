import { describe, expect, it } from 'vitest'
import { flatExposure, type FlatExposure } from './flats.ts'
import { entry, fold, velaStarted } from './testing.ts'

const reduce = (entries: Parameters<typeof fold>[2]) => fold<FlatExposure | undefined>(flatExposure, undefined, entries)

const tried = (at: number, verdict: string) => entry('vela.flats.exposure', at, { exposureSeconds: 0.5, sky: 9000, verdict })

describe('flat exposure', () => {
  it('stops a test still being tried when Vela starts again', () => {
    expect(reduce([tried(100, 'trying'), velaStarted(200)])).toEqual({ exposureSeconds: 0.5, sky: 9000, verdict: 'stopped', at: 200 })
  })

  it('keeps a verdict that was reached', () => {
    const good = reduce([tried(100, 'good')])

    expect(reduce([tried(100, 'good'), velaStarted(200)])).toEqual(good)
    expect(reduce([velaStarted(200)])).toBeUndefined()
  })
})
