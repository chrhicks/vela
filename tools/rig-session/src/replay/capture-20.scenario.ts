import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { openCriaCheckout, type CriaCheckout } from './cria-checkout.ts'
import { fitsData } from './fits-data.ts'
import { runScenario } from './scenario.ts'
import { synthesizeTape } from './tape.ts'
import { tapeFrames } from './tape-frames.ts'

const sensor = { width: 160, height: 128 }

const stars = Array.from({ length: 20 }, (_, frame) => [12, 9, 6, 3, 1][frame % 5]!)

let cria: CriaCheckout

let scratch: string

let tape: string

beforeAll(async () => {
  cria = await openCriaCheckout(process.env.CRIA_CHECKOUT)
  scratch = await mkdtemp(join(tmpdir(), 'capture-20-'))
  tape = await synthesizeTape(
    cria,
    {
      sensor,
      exposureSeconds: 0.5,
      stars,
      site: { latitudeDegrees: 10, longitudeDegrees: 20 },
      startAt: Date.UTC(2030, 0, 1, 2),
      pointing: { raHours: 3, decDegrees: 20 },
    },
    scratch,
  )
})

afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true })
})

test('20 frames captured through Cria are saved with the pixels and star counts of the source', async () => {
  const result = await runScenario(tape, { cria, exposureSeconds: 0.5, attempts: 20 })
  const source = await tapeFrames(tape)

  expect(result.attempts.slice(0, 20).map(attempt => attempt.outcome)).toEqual(Array(20).fill('saved'))
  expect(result.frames).toHaveLength(20)
  expect(result.frames.map(frame => frame.statistics?.detectedStars)).toEqual(stars)
  expect(result.frames.every(frame => frame.width === 160 && frame.height === 128)).toBe(true)

  result.fits.forEach((fits, frame) => {
    expect(fitsData(fits, sensor.width, sensor.height).equals(fitsData(source[frame]!, sensor.width, sensor.height))).toBe(true)
  })
})
