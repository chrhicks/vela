import { describe, expect, it } from 'vitest'
import { parseRequest, sequenceName } from './request.ts'

const good = { object: 'M 31', frameType: 'light', exposureSeconds: 120, count: 10, gain: 100, offset: 50, cooler: 'on', setpoint: -10 }

describe('parseRequest', () => {
  it('accepts a full request and names the files by object and frame type', () => {
    expect(parseRequest(good)).toMatchObject({ ok: true, sequence: 'M-31_light', request: { count: 10, setpoint: -10 } })
  })

  it('refuses an exposure that is not positive, a count that is not a whole number and a negative gain', () => {
    expect(parseRequest({ ...good, exposureSeconds: 0 }).ok).toBe(false)
    expect(parseRequest({ ...good, count: 2.5 }).ok).toBe(false)
    expect(parseRequest({ ...good, gain: -1 }).ok).toBe(false)
    expect(parseRequest({ ...good, frameType: 'bright' }).ok).toBe(false)
  })

  it('refuses an object name with nothing to name files by', () => {
    expect(parseRequest({ ...good, object: ' / ' })).toEqual({ ok: false, reason: 'the object name has no letters or digits to name the files by' })
  })

  it('needs a setpoint only when the cooler is on', () => {
    const { setpoint: _, ...without } = good

    expect(parseRequest(without)).toEqual({ ok: false, reason: 'a setpoint is needed when the cooler is on' })
    expect(parseRequest({ ...without, cooler: 'off' }).ok).toBe(true)
  })
})

describe('sequenceName', () => {
  it('keeps only letters and digits, joined by hyphens', () => {
    expect(sequenceName("Barnard's Loop/Orion", 'dark')).toBe('Barnard-s-Loop-Orion_dark')
  })
})
