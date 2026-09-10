import { z } from 'zod'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { encodeCaptureFits } from '../imaging/fits.js'
import type { ImageColor } from '../imaging/preview.js'

export interface MonoFrame {
  width: number
  height: number
  pixels: ArrayLike<number>
  capturedAt: string
  color?: ImageColor
}

export interface SkyPosition { raDegrees: number, decDegrees: number }

export interface PlateWcs {
  width: number
  height: number
  referenceX: number
  referenceY: number
  raDegrees: number
  decDegrees: number
  cd: readonly [number, number, number, number]
}

export type SolveResult = { status: 'no-solution' } | ({ status: 'solved', capturedAt: string, wcs: PlateWcs } & SkyPosition)

export interface PlateSolver {
  solve(frame: MonoFrame, hint: SkyPosition, signal: AbortSignal): Promise<SolveResult>
}

/** ASTAP CLI boundary. Coordinates are ASTAP's fixed catalog frame; conversion
 * to apparent/topocentric positions belongs to the consuming workflow.
 * CLI contract: https://www.hnsky.org/astap.htm#command_line */
export function createAstapSolver(config: {
  executable: string
  catalogPath: string
  fieldHeightDegrees: number
  timeoutMs?: number
}): PlateSolver {
  const executable = resolve(config.executable)
  const catalog = resolve(config.catalogPath)
  const timeout = config.timeoutMs ?? 30_000

  if (!config.executable.trim() || !config.catalogPath.trim()
    || !Number.isFinite(config.fieldHeightDegrees) || config.fieldHeightDegrees <= 0 || config.fieldHeightDegrees > 90
    || !Number.isFinite(timeout) || timeout <= 0 || timeout > 120_000) throw new Error('Invalid ASTAP configuration')

  return {
    async solve(frame, hint, signal) {
      signal.throwIfAborted()
      validatePosition(hint)
      const image = await encodeCaptureFits(frame, { exposureSeconds: 0, cameraName: 'Plate-solving exposure' })
      const directory = await mkdtemp(join(tmpdir(), 'vela-astap-'))

      try {
        const path = join(directory, 'exposure.fits')
        await writeFile(path, image)
        signal.throwIfAborted()

        const code = await runAstap(executable, ['-f', path, '-d', catalog,
          '-fov', String(config.fieldHeightDegrees), '-ra', String(hint.raDegrees / 15),
          '-spd', String(hint.decDegrees + 90), '-r', '5', '-s', '1000',
          ...(frame.color?.kind === 'bayer' ? ['-check', 'y'] : [])], signal, timeout)

        signal.throwIfAborted()

        // ASTAP exit 1 means no match, 2 means not enough stars. Database,
        // process, image and output failures must not become endless sky retries.
        if (code === 1 || code === 2) return { status: 'no-solution' }

        if (code !== 0) throw new Error(`ASTAP failed with exit code ${code}`)
        const wcs = parseWcs(await readFile(join(directory, 'exposure.ini'), 'utf8'), frame)
        signal.throwIfAborted()

        return { status: 'solved', capturedAt: frame.capturedAt,
          raDegrees: wcs.raDegrees, decDegrees: wcs.decDegrees, wcs }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  }
}

function runAstap(executable: string, args: string[], signal: AbortSignal, timeout: number): Promise<number> {
  return new Promise((resolveCode, reject) => {
    // SIGKILL also bounds tools that ignore SIGTERM. execFile waits for exit
    // before callback/cleanup; cancellation cannot leave a writer in the tempdir.
    let cancelled = false

    const child = execFile(executable, args, { timeout, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 }, error => {
      signal.removeEventListener('abort', abort)

      if (cancelled) return reject(signal.reason ?? new Error('Plate solving cancelled'))

      if (!error) return resolveCode(0)

      const exitCode = z.number().safeParse(error.code)

      if (!error.killed && exitCode.success) return resolveCode(exitCode.data)
      reject(new Error(error.killed ? 'ASTAP timed out' : `ASTAP could not run: ${error.message}`, { cause: error }))
    })

    const abort = () => { cancelled = true; child.kill('SIGKILL') }

    signal.addEventListener('abort', abort, { once: true })

    if (signal.aborted) abort()
  })
}

function parseWcs(text: string, image: { width: number, height: number }): PlateWcs {
  const values = new Map<string, string>()

  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf('=')

    if (index > 0) values.set(line.slice(0, index).trim(), line.slice(index + 1).trim())
  }

  const number = (key: string) => {
    const raw = values.get(key)

    if (!raw || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) throw new Error(`Invalid ASTAP ${key}`)
    const value = Number(raw)

    if (!Number.isFinite(value)) throw new Error(`Invalid ASTAP ${key}`)

    return value
  }

  if (values.get('PLTSOLVD') !== 'T') throw new Error('ASTAP success did not contain a solved plate')

  const wcs: PlateWcs = { width: image.width, height: image.height, referenceX: number('CRPIX1'), referenceY: number('CRPIX2'),
    raDegrees: number('CRVAL1'), decDegrees: number('CRVAL2'),
    cd: [number('CD1_1'), number('CD1_2'), number('CD2_1'), number('CD2_2')] }

  validatePosition(wcs)

  if (Math.abs(wcs.referenceX - (image.width + 1) / 2) > 1e-6
    || Math.abs(wcs.referenceY - (image.height + 1) / 2) > 1e-6
    || Math.abs(wcs.cd[0] * wcs.cd[3] - wcs.cd[1] * wcs.cd[2]) < 1e-15) throw new Error('Invalid ASTAP reference pixel or plate scale')

  return wcs
}

/** Project a sky position into ASTAP's FITS WCS, in zero-based image pixels. */
export function projectSky(wcs: PlateWcs, position: SkyPosition): { x: number, y: number } | null {
  validatePosition(position)
  const radians = Math.PI / 180
  const delta = (position.raDegrees - wcs.raDegrees) * radians
  const dec = position.decDegrees * radians
  const center = wcs.decDegrees * radians
  const depth = Math.sin(center) * Math.sin(dec) + Math.cos(center) * Math.cos(dec) * Math.cos(delta)

  if (depth <= 0) return null
  const east = Math.cos(dec) * Math.sin(delta) / depth / radians
  const north = (Math.cos(center) * Math.sin(dec) - Math.sin(center) * Math.cos(dec) * Math.cos(delta)) / depth / radians
  const [a, b, c, d] = wcs.cd
  const determinant = a * d - b * c

  return { x: wcs.referenceX - 1 + (east * d - north * b) / determinant,
    y: wcs.referenceY - 1 + (north * a - east * c) / determinant }
}

function validatePosition(position: SkyPosition) {
  if (!Number.isFinite(position.raDegrees) || position.raDegrees < 0 || position.raDegrees >= 360
    || !Number.isFinite(position.decDegrees) || Math.abs(position.decDegrees) > 90) throw new Error('Invalid plate coordinates')
}
