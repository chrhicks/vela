import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { tileCount, tileFile } from '../../state/survey.ts'
import { downloadSurvey, readSurvey, SurveySettings, tileAddress } from './survey.ts'

const address = 'https://survey.test/DSSColor'
const properties = 'obs_title            = DSS colored\nobs_copyright        = Digitized Sky Survey - STScI/NASA, Colored & Healpixed by CDS\nhips_order           = 9\n'

function serving(missing: ReadonlyArray<string> = []) {
  const asked: Array<string> = []

  vi.stubGlobal('fetch', (url: string) => {
    asked.push(url)

    if (missing.some(part => url.endsWith(part))) return Promise.resolve(new Response('gone', { status: 404 }))

    return Promise.resolve(new Response(url.endsWith('/properties') ? properties : `picture of ${url}`))
  })

  return asked
}

const settingsIn = (tilesDir: string) => Layer.succeed(SurveySettings, { tilesDir, address, order: 0, downloads: 3 })
const folder = () => join(mkdtempSync(join(tmpdir(), 'vela-sky-')), 'dss')

afterEach(() => vi.unstubAllGlobals())

describe('the sky survey', () => {
  it('has twelve tiles at order 0 and four times as many at each order after', () => {
    expect([0, 1, 4].map(tileCount)).toEqual([12, 48, 3072])
  })

  it('asks the survey for a tile in its folder of ten thousand', () => {
    expect(tileAddress(address, 4, 2731)).toBe('https://survey.test/DSSColor/Norder4/Dir0/Npix2731.jpg')
    expect(tileAddress(address, 7, 123456)).toBe('https://survey.test/DSSColor/Norder7/Dir120000/Npix123456.jpg')
  })

  it('downloads every tile, and says what the survey is', async () => {
    const tilesDir = folder()
    const asked = serving()
    const result = await Effect.runPromise(downloadSurvey.pipe(Effect.provide(settingsIn(tilesDir))))

    expect(result.fetched).toBe(12)
    expect(readdirSync(join(tilesDir, 'Norder0')).sort()).toEqual(Array.from({ length: 12 }, (_, tile) => `Npix${tile}.jpg`).sort())
    expect(readFileSync(join(tilesDir, tileFile(0, 7)), 'utf8')).toBe(`picture of ${address}/Norder0/Dir0/Npix7.jpg`)
    expect(asked).toHaveLength(13)
    expect(await Effect.runPromise(readSurvey.pipe(Effect.provide(settingsIn(tilesDir))))).toMatchObject({ name: 'DSS colored', credit: 'Digitized Sky Survey - STScI/NASA, Colored & Healpixed by CDS', address, order: 0, tileWidth: 512, tiles: 12 })
  })

  it('carries on from the tiles already kept when it is run again', async () => {
    const tilesDir = folder()

    serving(['Npix5.jpg'])

    expect(await Effect.runPromise(Effect.result(downloadSurvey).pipe(Effect.provide(settingsIn(tilesDir))))).toMatchObject({ _tag: 'Failure', failure: { _tag: 'SurveyUnreachable', address: `${address}/Norder0/Dir0/Npix5.jpg` } })

    const before = readdirSync(join(tilesDir, 'Norder0')).length
    const asked = serving()
    const again = await Effect.runPromise(downloadSurvey.pipe(Effect.provide(settingsIn(tilesDir))))

    expect(again.fetched).toBe(12 - before)
    expect(asked).toHaveLength(1 + 12 - before)
  })

  it('is unreadable until it has been downloaded', async () => {
    const tilesDir = folder()

    expect(await Effect.runPromise(Effect.result(readSurvey).pipe(Effect.provide(settingsIn(tilesDir))))).toMatchObject({ _tag: 'Failure', failure: { _tag: 'SurveyUnreadable', path: join(tilesDir, 'survey.json') } })
  })
})
