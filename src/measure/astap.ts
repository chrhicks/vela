import { execFile } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import type { Card } from '../frames/fits.ts'

const run = promisify(execFile)

export interface AstapSettings {
  readonly program: string
  readonly database: string
  readonly workDir: string
  readonly analyseSnr: number
}

export interface Stars {
  readonly hfd: number
  readonly stars: number
}

export type Solution = { readonly ok: true; readonly raDegrees: number; readonly decDegrees: number } | { readonly ok: false; readonly reason: string }

function fields(text: string) {
  return new Map(
    text
      .split('\n')
      .map(line => line.split('='))
      .filter(parts => parts.length >= 2)
      .map(([key = '', ...rest]) => [key.trim(), rest.join('=').trim()]),
  )
}

export function readAnalysis(stdout: string): Stars | undefined {
  const found = fields(stdout)
  const hfd = Number(found.get('HFD_MEDIAN'))
  const stars = Number(found.get('STARS'))

  return Number.isFinite(hfd) && Number.isInteger(stars) ? { hfd, stars } : undefined
}

export function readSolution(ini: string): Solution {
  const found = fields(ini)
  const ra = Number(found.get('CRVAL1'))
  const dec = Number(found.get('CRVAL2'))

  if (found.get('PLTSOLVD') !== 'T') return { ok: false, reason: found.get('ERROR') || found.get('WARNING') || 'no solution' }

  return Number.isFinite(ra) && Number.isFinite(dec) ? { ok: true, raDegrees: ra, decDegrees: dec } : { ok: false, reason: 'the solution has no centre' }
}

export function fieldHeightDegrees(cards: ReadonlyArray<Card>): number | undefined {
  const number = (key: string) => Number(cards.find(card => card.key === key)?.value)
  const pixel = cards.some(card => card.key === 'YPIXSZ') ? number('YPIXSZ') : number('XPIXSZ')
  const height = (number('NAXIS2') * pixel) / 1000 / number('FOCALLEN')

  return Number.isFinite(height) && height > 0 ? (2 * Math.atan(height / 2) * 180) / Math.PI : undefined
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function makeAstap(settings: AstapSettings) {
  return {
    async analyse(path: string): Promise<Stars | undefined> {
      const { stdout } = await run(settings.program, ['-f', path, '-analyse', String(settings.analyseSnr)])

      return readAnalysis(stdout)
    },

    async solve(path: string, fieldHeight: number | undefined): Promise<Solution> {
      const base = join(settings.workDir, basename(path, '.fits'))

      await mkdir(settings.workDir, { recursive: true })

      try {
        await run(settings.program, ['-f', path, '-r', '180', '-fov', fieldHeight === undefined ? '0' : fieldHeight.toFixed(3), '-d', settings.database, '-o', base])
      } catch (error) {
        const ini = await readFile(`${base}.ini`, 'utf8').catch(() => undefined)

        return ini === undefined ? { ok: false, reason: `ASTAP failed: ${errorText(error)}` } : readSolution(ini)
      }

      return readSolution(await readFile(`${base}.ini`, 'utf8'))
    },
  }
}

export type Astap = ReturnType<typeof makeAstap>
