import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Logger } from 'effect'
import { describe, expect, it } from 'vitest'
import { altitudeAt, noHorizon } from './horizon.ts'
import { HorizonUnreadable, loadHorizon, readHorizon } from './file.ts'

const folder = () => mkdtemp(join(tmpdir(), 'vela-horizon-'))

const bins = (value: number | string | null) => Array.from({ length: 360 }, () => value)

const file = (changes: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 2,
    stepDegrees: 1,
    altitudesDegrees: bins(5).map((_, bin) => (bin < 180 ? 5 + bin / 10 : null)),
    sources: bins('sweep').map((_, bin) => (bin < 180 ? 'sweep' : null)),
    observedAt: bins('2026-01-02T03:04:05Z').map((_, bin) => (bin < 180 ? '2026-01-02T03:04:05Z' : null)),
    ...changes,
  })

describe('the horizon file', () => {
  it('reads a version 2 file and answers from it', async () => {
    const path = join(await folder(), 'horizon.json')

    await writeFile(path, file())

    const horizon = await Effect.runPromise(readHorizon(path))

    expect(altitudeAt(horizon, 10.5)).toBeCloseTo(6.05, 10)
    expect(altitudeAt(horizon, 179.5)).toBeNull()
    expect(altitudeAt(horizon, 250)).toBeNull()
  })

  it('reads a file with no origins as every bin of unknown origin', async () => {
    const path = join(await folder(), 'horizon.json')

    await writeFile(path, file())

    const horizon = await Effect.runPromise(readHorizon(path))

    expect(horizon.origins).toEqual(noHorizon.origins)
    expect(horizon.origins).toHaveLength(360)
  })

  it('reads the origin of each bin, the sweep and the night its records are in', async () => {
    const path = join(await folder(), 'horizon.json')
    const origin = { sweep: 'sweep-aaaa-1111', night: '2026-01-02' }

    await writeFile(path, file({ origins: bins('x').map((_, bin) => (bin < 180 ? origin : null)) }))

    const horizon = await Effect.runPromise(readHorizon(path))

    expect(horizon.origins[10]).toEqual(origin)
    expect(horizon.origins[200]).toBeNull()
  })

  it('has no horizon when there is no file', async () => {
    const path = join(await folder(), 'horizon.json')

    expect(await Effect.runPromise(readHorizon(path))).toEqual(noHorizon)
    expect(await Effect.runPromise(loadHorizon(path))).toEqual(noHorizon)
  })

  it('says once that there is no file', async () => {
    const path = join(await folder(), 'horizon.json')
    const lines: Array<string> = []
    const collect = Logger.make<unknown, void>(({ message }) => void lines.push(String(Array.isArray(message) ? message.join(' ') : message)))
    const horizon = await Effect.runPromise(loadHorizon(path).pipe(Effect.provide(Logger.layer([collect]))))

    expect(horizon).toEqual(noHorizon)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(path)
  })

  it.each([
    ['not json', 'horizon'],
    ['an old version', file({ version: 1 })],
    ['a step that is not one degree', file({ stepDegrees: 2 })],
    ['too few altitudes', file({ altitudesDegrees: bins(5).slice(0, 359) })],
    ['too many sources', file({ sources: bins('sweep').concat(['sweep']) })],
    ['a source that is not named', file({ sources: bins('moon') })],
    ['an altitude that is not a number', file({ altitudesDegrees: bins('high') })],
    ['a time that is not a time', file({ observedAt: bins('tonight') })],
    ['an origin with a night that is not a night', file({ origins: bins('x').map(() => ({ sweep: 'sweep-aaaa-1111', night: 'last night' })) })],
    ['an origin with no sweep', file({ origins: bins('x').map(() => ({ night: '2026-01-02' })) })],
    ['origins that are not 360', file({ origins: [null] })],
  ])('says the file is unreadable with %s', async (_, text) => {
    const path = join(await folder(), 'horizon.json')

    await writeFile(path, text)

    const error = await Effect.runPromise(Effect.flip(readHorizon(path)))

    expect(error).toBeInstanceOf(HorizonUnreadable)
    expect(error).toMatchObject({ _tag: 'HorizonUnreadable', path })
  })

  it('treats an unreadable file as no horizon and says so once', async () => {
    const path = join(await folder(), 'horizon.json')

    await writeFile(path, file({ version: 1 }))

    const lines: Array<string> = []
    const collect = Logger.make<unknown, void>(({ message }) => void lines.push(String(Array.isArray(message) ? message.join(' ') : message)))
    const horizon = await Effect.runPromise(loadHorizon(path).pipe(Effect.provide(Logger.layer([collect]))))

    expect(horizon).toEqual(noHorizon)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(path)
  })
})
