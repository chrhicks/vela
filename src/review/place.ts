import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Result, Schema } from 'effect'
import { readCards } from '../frames/library.ts'
import type { HeaderValue } from '../frames/fits.ts'
import { fieldHeightDegrees, pointingOf, PlateSolution, statsName } from '../frames/stats.ts'
import { siteAt } from '../pointing/target.ts'
import type { FrameView } from './line.ts'

const decodeSolution = Schema.decodeUnknownResult(Schema.NullOr(PlateSolution))

const timeZone = /(Z|[+-]\d{2}:?\d{2})$/

const solutionOf = (directory: string, file: string) =>
  readFile(join(directory, statsName(file)), 'utf8').then(
    text => {
      const stats: unknown = JSON.parse(text)
      const decoded = decodeSolution(typeof stats === 'object' && stats !== null && 'solution' in stats ? stats.solution : null)

      return Result.isSuccess(decoded) ? decoded.success : null
    },
    () => null,
  )

export async function placeFrame(keepDir: string, night: string, file: string): Promise<FrameView | undefined> {
  const directory = join(keepDir, night)
  const cards = await readCards(join(directory, file)).catch(() => undefined)

  if (cards === undefined) return undefined

  const header = new Map<string, HeaderValue>(cards.map(card => [card.key, card.value !== '' && Number.isFinite(Number(card.value)) ? Number(card.value) : card.value]))
  const number = (key: string) => {
    const value = header.get(key)

    return typeof value === 'number' ? value : undefined
  }
  const started = String(header.get('DATE-OBS') ?? '')
  const startedAt = Date.parse(timeZone.test(started) ? started : `${started}Z`)
  const exposure = number('EXPTIME')
  const latitude = number('SITELAT')
  const longitude = number('SITELONG')
  const columns = number('NAXIS1')
  const rows = number('NAXIS2')
  const mount = pointingOf(header)
  const heightDegrees = rows === undefined ? undefined : fieldHeightDegrees(header, rows)

  if (!Number.isFinite(startedAt) || exposure === undefined || latitude === undefined || longitude === undefined || columns === undefined || rows === undefined || mount === undefined || heightDegrees === undefined) return undefined

  return {
    at: startedAt + exposure * 500,
    site: siteAt(latitude, longitude, number('SITEELEV')),
    columns,
    rows,
    heightDegrees,
    mount,
    solution: await solutionOf(directory, file),
  }
}
