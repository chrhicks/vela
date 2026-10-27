import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { horizonFilePath, parseHorizonProfile, writeHorizonProfile } from '@vela/server/targets/horizon'
import { convertSurvey, type ConvertOptions } from './convert.ts'

/** Synthetic survey, 1 degree source step: flat 5 degrees, a 30 degree tree at 100 to 109, no trace at 200 to 209. */
function survey() {
  return {
    stepDeg: 1,
    samples: Array.from({ length: 360 }, (_, az) => ({
      az,
      smooth: az >= 100 && az < 110 ? 30 : 5,
      supported: !(az >= 200 && az < 210),
    })),
  }
}

const options: ConvertOptions = {
  azimuthOffsetDegrees: 0,
  altitudeOffsetDegrees: 0,
  stepDegrees: 1,
  importedAt: new Date('2026-01-01T00:00:00Z'),
}

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('convertSurvey', () => {
  it('bins traced altitudes and marks untraced stretches unknown, never zero', () => {
    const { profile, traced, unknown } = convertSurvey(survey(), options)

    expect(profile.altitudesDegrees).toHaveLength(360)
    expect(profile.altitudesDegrees[50]).toBe(5)
    expect(profile.altitudesDegrees[105]).toBe(30)
    expect(profile.altitudesDegrees.slice(200, 210)).toEqual(Array.from({ length: 10 }, () => null))
    expect(unknown).toBe(10)
    expect(traced).toBe(350)
    expect(profile.approximate).toBe(true)
  })

  it('moves azimuth by the offset, wrapping past north, and lifts altitude by its offset', () => {
    const { profile } = convertSurvey(survey(), {
      ...options,
      azimuthOffsetDegrees: 13.44,
      altitudeOffsetDegrees: 1,
    })

    expect(profile.offsets).toEqual({ azimuthDegrees: 13.44, altitudeDegrees: 1 })
    expect(profile.altitudesDegrees[112]).toBe(6)
    expect(profile.altitudesDegrees.slice(113, 123)).toEqual(Array.from({ length: 10 }, () => 31))
    expect(profile.altitudesDegrees[123]).toBe(6)

    const wrapped = convertSurvey(survey(), { ...options, azimuthOffsetDegrees: -105 })
    expect(wrapped.profile.altitudesDegrees[354]).toBe(5)
    expect(wrapped.profile.altitudesDegrees.slice(355)).toEqual(Array.from({ length: 5 }, () => 30))
    expect(wrapped.profile.altitudesDegrees.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => 30))
    expect(wrapped.profile.altitudesDegrees[5]).toBe(5)
  })

  it('keeps the highest sample of a coarser bin and makes a partly untraced bin unknown', () => {
    const { profile } = convertSurvey(survey(), { ...options, stepDegrees: 5 })

    expect(profile.altitudesDegrees).toHaveLength(72)
    expect(profile.altitudesDegrees[20]).toBe(30)

    const partial = convertSurvey(
      { stepDeg: 1, samples: [{ az: 0, smooth: 9, supported: true }, { az: 1, smooth: 8, supported: false }] },
      { ...options, stepDegrees: 90 },
    )

    expect(partial.profile.altitudesDegrees).toEqual([null, null, null, null])
  })

  it('treats a sample without a number or a support flag as untraced', () => {
    const { profile } = convertSurvey(
      { stepDeg: 1, samples: [{ az: 0, smooth: null, supported: true }, { az: 1, smooth: 7 }, { az: 2, smooth: 7, supported: true }] },
      { ...options, stepDegrees: 1 },
    )

    expect(profile.altitudesDegrees.slice(0, 3)).toEqual([null, null, 7])
  })

  it('floors altitude at 0 and caps it at 90', () => {
    const { profile } = convertSurvey(
      { stepDeg: 1, samples: [{ az: 0, smooth: -3, supported: true }, { az: 1, smooth: 95, supported: true }] },
      options,
    )

    expect(profile.altitudesDegrees.slice(0, 2)).toEqual([0, 90])
  })

  it('refuses a step that does not divide 360, bad offsets and a malformed survey', () => {
    expect(() => convertSurvey(survey(), { ...options, stepDegrees: 7 })).toThrow(RangeError)
    expect(() => convertSurvey(survey(), { ...options, stepDegrees: 0 })).toThrow(RangeError)
    expect(() => convertSurvey(survey(), { ...options, azimuthOffsetDegrees: Number.NaN })).toThrow(RangeError)
    expect(() => convertSurvey({ stepDeg: 1, samples: [] }, options)).toThrow()
    expect(() => convertSurvey({ samples: [{ az: 0 }] }, options)).toThrow()
  })

  it('produces a file the server reader accepts, private to its owner', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vela-horizon-import-'))
    directories.push(dir)
    const path = horizonFilePath(dir, 'rig-1')!
    const { profile } = convertSurvey(survey(), options)

    await writeHorizonProfile(path, profile)
    expect(parseHorizonProfile(JSON.parse(await readFile(path, 'utf8')))).toEqual(profile)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })
})
