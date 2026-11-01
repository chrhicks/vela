import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { SolveBody, SkyPosition } from '@vela/rig-events'
import { writeFits } from './fits-write.ts'
import type { MonoFrame } from './frame.ts'

export type PlateWcs = Extract<SolveBody, { readonly status: 'solved' }>['wcs']

export interface AstapConfig {
  readonly executable: string
  readonly catalogPath: string
  readonly fieldHeightDegrees: number
  readonly timeoutMs?: number
  readonly workDirectory?: string
}

export type AstapSolution =
  | { readonly status: 'solved'; readonly centre: SkyPosition; readonly wcs: PlateWcs; readonly radiusDegrees: number }
  | { readonly status: 'no-solution'; readonly reason: 'no-match' | 'too-few-stars'; readonly radiusDegrees: number }

export interface AstapSolver {
  solve(frame: MonoFrame, hint: SkyPosition, signal: AbortSignal): Promise<AstapSolution>
}

export class AstapTimeout extends Error {
  readonly radiusDegrees: number

  constructor(radiusDegrees: number) {
    super('ASTAP timed out')
    this.radiusDegrees = radiusDegrees
  }
}

const searchRadii = [10, 15, 30, 60, 120, 180] as const

function checkPosition(position: SkyPosition) {
  if (!Number.isFinite(position.raDegrees) || position.raDegrees < 0 || position.raDegrees >= 360 || !Number.isFinite(position.decDegrees) || Math.abs(position.decDegrees) > 90)
    throw new Error('Invalid plate coordinates')
}

function parseWcs(text: string, image: { readonly width: number; readonly height: number }): PlateWcs {
  const values = new Map<string, string>()

  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf('=')

    if (index > 0) values.set(line.slice(0, index).trim(), line.slice(index + 1).trim())
  }

  const number = (key: string) => {
    const raw = values.get(key)

    if (!raw || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) throw new Error(`Invalid ASTAP ${key}`)

    return Number(raw)
  }

  if (values.get('PLTSOLVD') !== 'T') throw new Error('ASTAP success did not contain a solved plate')

  const cd: PlateWcs['cd'] = [number('CD1_1'), number('CD1_2'), number('CD2_1'), number('CD2_2')]

  const wcs = {
    width: image.width,
    height: image.height,
    referenceX: number('CRPIX1'),
    referenceY: number('CRPIX2'),
    raDegrees: number('CRVAL1'),
    decDegrees: number('CRVAL2'),
    cd,
  }

  checkPosition(wcs)

  if (
    Math.abs(wcs.referenceX - (image.width + 1) / 2) > 1e-6 ||
    Math.abs(wcs.referenceY - (image.height + 1) / 2) > 1e-6 ||
    Math.abs(cd[0] * cd[3] - cd[1] * cd[2]) < 1e-15
  )
    throw new Error('Invalid ASTAP reference pixel or plate scale')

  return wcs
}

function run(executable: string, args: readonly string[], signal: AbortSignal, timeoutMs: number, radiusDegrees: number): Promise<number> {
  return new Promise((resolveCode, reject) => {
    const child = execFile(executable, [...args], { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 }, error => {
      signal.removeEventListener('abort', abort)

      if (signal.aborted) return reject(signal.reason ?? new Error('Plate solving cancelled'))

      if (!error) return resolveCode(0)

      if (error.killed) return reject(new AstapTimeout(radiusDegrees))

      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Node reports an exit status as a number and a spawn failure as a string.
      if (typeof error.code === 'number') return resolveCode(error.code)

      reject(new Error(`ASTAP could not run: ${error.message}`, { cause: error }))
    })

    const abort = () => child.kill('SIGKILL')

    signal.addEventListener('abort', abort, { once: true })

    if (signal.aborted) abort()
  })
}

/**
 * Coordinates come back in ASTAP's own frame, J2000. Exit code 1 means no match at this radius, 2 means
 * too few stars for any radius.
 */
export function createAstapSolver(config: AstapConfig): AstapSolver {
  const executable = resolve(config.executable)
  const catalog = resolve(config.catalogPath)
  const timeoutMs = config.timeoutMs ?? 30_000

  if (!config.executable.trim() || !config.catalogPath.trim() || !(config.fieldHeightDegrees > 0 && config.fieldHeightDegrees <= 90) || !(timeoutMs > 0 && timeoutMs <= 120_000))
    throw new Error('Invalid ASTAP configuration')

  return {
    async solve(frame, hint, signal) {
      checkPosition(hint)
      signal.throwIfAborted()

      const deadline = performance.now() + timeoutMs
      const directory = await mkdtemp(join(config.workDirectory ?? tmpdir(), 'rig-astap-'))

      try {
        const path = join(directory, 'exposure.fits')
        await writeFile(path, writeFits(frame))

        for (const radius of searchRadii) {
          signal.throwIfAborted()

          const remaining = Math.floor(deadline - performance.now())

          if (remaining <= 0) throw new AstapTimeout(radius)

          const code = await run(
            executable,
            [
              '-f', path,
              '-d', catalog,
              '-fov', String(config.fieldHeightDegrees),
              '-ra', String(hint.raDegrees / 15),
              '-spd', String(hint.decDegrees + 90),
              '-r', String(radius),
              '-s', '1000',
              ...(frame.color.kind === 'bayer' ? ['-check', 'y'] : []),
            ],
            signal,
            remaining,
            radius,
          )

          if (code === 2) return { status: 'no-solution', reason: 'too-few-stars', radiusDegrees: radius }

          if (code === 1) continue

          if (code !== 0) throw new Error(`ASTAP failed with exit code ${code}`)

          const wcs = parseWcs(await readFile(join(directory, 'exposure.ini'), 'utf8'), frame)

          return { status: 'solved', centre: { raDegrees: wcs.raDegrees, decDegrees: wcs.decDegrees }, wcs, radiusDegrees: radius }
        }

        return { status: 'no-solution', reason: 'no-match', radiusDegrees: searchRadii[searchRadii.length - 1] ?? 180 }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  }
}

/** The version line ASTAP prints for `-h`, for example `astap-CLI-2026.09.01`. */
export function astapVersion(executable: string): Promise<string> {
  return new Promise((resolveVersion, reject) => {
    execFile(resolve(executable), ['-h'], { timeout: 10_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      const version = /version (\S+)/.exec(stdout)?.[1]

      if (version) return resolveVersion(`astap-${version}`)

      reject(new Error(error ? `ASTAP could not run: ${error.message}` : 'ASTAP did not print a version'))
    })
  })
}
