import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Context, Data, Effect, Schema } from 'effect'
import { described } from '../config.ts'
import { Survey, tileCount, tileFile } from '../../state/survey.ts'

export const SurveyConfig = Schema.Struct({
  tilesDir: described('The folder the sky survey setup downloads the survey tiles into and Vela serves them from', Schema.String, '/mnt/storage/vela/sky/dss-colour'),
  address: described('The address of the survey to download, a HiPS tile set with JPEG tiles', Schema.String, 'https://skies.esac.esa.int/DSSColor'),
  order: described('The HiPS order downloaded: order 4 is 3,072 tiles of 512 pixels, 26 arcseconds a pixel', Schema.Int, 4),
  downloads: described('Tiles downloaded at the same time by the sky survey setup', Schema.Int, 4),
})

export class SurveySettings extends Context.Service<SurveySettings, typeof SurveyConfig.Type>()('vela/SurveySettings') {}

export class SurveyUnreachable extends Data.TaggedError('SurveyUnreachable')<{ readonly address: string; readonly reason: string }> {}

export class SurveyUnwritable extends Data.TaggedError('SurveyUnwritable')<{ readonly path: string; readonly reason: string }> {}

export class SurveyUnreadable extends Data.TaggedError('SurveyUnreadable')<{ readonly path: string; readonly reason: string }> {}

const surveyFile = 'survey.json'
const tileWidth = 512
const directorySize = 10_000

const reasonOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

export const tileAddress = (address: string, order: number, tile: number) => `${address}/Norder${order}/Dir${Math.floor(tile / directorySize) * directorySize}/Npix${tile}.jpg`

const fetched = (address: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(address)

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      return Buffer.from(await response.arrayBuffer())
    },
    catch: cause => new SurveyUnreachable({ address, reason: reasonOf(cause) }),
  })

const written = (path: string, bytes: Buffer | string) =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(`${path}.part`, bytes)
      await rename(`${path}.part`, path)
    },
    catch: cause => new SurveyUnwritable({ path, reason: reasonOf(cause) }),
  })

const kept = (path: string) => Effect.promise(() => stat(path).then(found => found.size > 0, () => false))

const propertyOf = (properties: string, key: string) => new RegExp(`^${key}\\s*=\\s*(.*)$`, 'm').exec(properties)?.[1]?.trim()

export const downloadSurvey = Effect.gen(function* () {
  const { tilesDir, address, order, downloads } = yield* SurveySettings
  const properties = (yield* fetched(`${address}/properties`)).toString('utf8')
  const tiles = Array.from({ length: tileCount(order) }, (_, tile) => tile)

  const downloaded = yield* Effect.forEach(
    tiles,
    tile => {
      const path = join(tilesDir, tileFile(order, tile))

      return Effect.flatMap(kept(path), already => (already ? Effect.succeed(0) : fetched(tileAddress(address, order, tile)).pipe(Effect.flatMap(bytes => written(path, bytes)), Effect.as(1))))
    },
    { concurrency: downloads },
  )

  const survey: Survey = {
    name: propertyOf(properties, 'obs_title') ?? address,
    credit: propertyOf(properties, 'obs_copyright') ?? address,
    address,
    order,
    tileWidth,
    tiles: tiles.length,
    pulledAt: new Date().toISOString(),
  }

  yield* written(join(tilesDir, 'properties'), properties)
  yield* written(join(tilesDir, surveyFile), JSON.stringify(survey, null, 2))

  return { survey, fetched: downloaded.reduce<number>((sum, one) => sum + one, 0), tilesDir }
})

const decodeSurvey = Schema.decodeUnknownEffect(Schema.fromJsonString(Survey))

export const readSurvey = Effect.gen(function* () {
  const { tilesDir } = yield* SurveySettings
  const path = join(tilesDir, surveyFile)
  const text = yield* Effect.tryPromise({ try: () => readFile(path, 'utf8'), catch: cause => new SurveyUnreadable({ path, reason: reasonOf(cause) }) })

  return yield* decodeSurvey(text).pipe(Effect.mapError(error => new SurveyUnreadable({ path, reason: error.message })))
})
