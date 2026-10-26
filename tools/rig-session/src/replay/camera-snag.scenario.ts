import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { openCriaCheckout, type CriaCheckout } from './cria-checkout.ts'
import { runScenario } from './scenario.ts'
import { synthesizeTape } from './tape.ts'

const snagAt = 6

const attempts = 12

let cria: CriaCheckout

let scratch: string

let tape: string

beforeAll(async () => {
  cria = await openCriaCheckout(process.env.CRIA_CHECKOUT)
  scratch = await mkdtemp(join(tmpdir(), 'camera-snag-'))
  tape = await synthesizeTape(
    cria,
    {
      sensor: { width: 160, height: 128 },
      exposureSeconds: 1,
      stars: Array(14).fill(12),
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

test('a camera that sends blank frames from frame 6 drops the star count to 0 and Vela raises stars-collapsed, with the mount tracking throughout', async () => {
  const result = await runScenario(tape, {
    cria,
    exposureSeconds: 1,
    attempts,
    faults: [{ kind: 'blank', at: snagAt, count: 100 }],
  })

  expect(result.frames.map(frame => frame.statistics?.detectedStars)).toEqual([12, 12, 12, 12, 12, 12, 0, 0, 0, 0, 0, 0])
  expect(result.attempts.slice(0, attempts).map(attempt => attempt.outcome)).toEqual(Array(attempts).fill('saved'))

  const collapsed = result.alertChanges.find(change => change.alerts.some(alert => alert.id === 'stars-collapsed'))

  expect(collapsed?.alerts).toEqual([{ id: 'stars-collapsed', level: 'critical', message: 'Star count fell to 0 (median 0, normal ≈12 stars), few peaks' }])
  // The first blank frame is the 7th attempt; two blank frames confirm the collapse.
  expect([7, 8]).toContain(collapsed?.afterAttempts)

  // Before the collapse, nothing, and never before the snag.
  const before = result.alertChanges.slice(0, result.alertChanges.indexOf(collapsed!))

  expect(before.flatMap(change => change.alerts.map(alert => alert.id))).toEqual([])
  expect(result.alertChanges.every(change => change.afterAttempts >= snagAt)).toBe(true)
  expect(result.alertChanges.flatMap(change => change.alerts.map(alert => alert.id))).not.toContain('tracking-stopped')
})
