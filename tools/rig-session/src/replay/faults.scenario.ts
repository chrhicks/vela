import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { openCriaCheckout, type CriaCheckout } from './cria-checkout.ts'
import { runScenario } from './scenario.ts'
import { synthesizeTape } from './tape.ts'

const mount = 'Synthetic Mount'

let cria: CriaCheckout

let scratch: string

let tape: string

beforeAll(async () => {
  cria = await openCriaCheckout(process.env.CRIA_CHECKOUT)
  scratch = await mkdtemp(join(tmpdir(), 'faults-'))
  tape = await synthesizeTape(
    cria,
    {
      mount,
      sensor: { width: 160, height: 128 },
      exposureSeconds: 3,
      stars: Array(24).fill(12),
      site: { latitudeDegrees: 10, longitudeDegrees: 20 },
      startAt: Date.UTC(2030, 0, 1, 2),
      pierSide: 'east',
      pointing: { raHours: 3, decDegrees: 20 },
    },
    scratch,
  )
})

afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true })
})

test('a mount silent for 40 s raises rig-unreachable once 30 s have passed, clears it when the mount answers, and capture goes on', async () => {
  const result = await runScenario(tape, {
    cria,
    exposureSeconds: 3,
    attempts: 20,
    faults: [{ kind: 'silent', at: 2, device: mount, forMs: 40_000 }],
  })

  expect(result.attempts.slice(0, 20).map(attempt => attempt.outcome)).toEqual(Array(20).fill('saved'))

  const [unreachable, recovered] = result.alertChanges

  expect(result.alertChanges).toHaveLength(2)
  expect(unreachable!.alerts.map(alert => [alert.id, alert.level])).toEqual([['rig-unreachable', 'critical']])

  // Named at a 10 s poll after the 30 s limit, so 30 to 40 s: the length of the silence.
  const seconds = Number(/^The rig has not answered for (\d+) s$/.exec(unreachable!.alerts[0]!.message)?.[1])

  expect(seconds).toBeGreaterThanOrEqual(30)
  expect(seconds).toBeLessThanOrEqual(40)
  expect(recovered!.alerts).toEqual([])
  // Silence starts at frame 2 and lasts 40 s, about 13 frames of 3.25 s.
  expect(recovered!.afterAttempts).toBeGreaterThan(unreachable!.afterAttempts)
  expect(unreachable!.afterAttempts).toBeGreaterThanOrEqual(10)
})

test('losing the indiserver connection during an exposure ends it uncertain, and Vela fails the run and says why', async () => {
  const result = await runScenario(tape, {
    cria,
    exposureSeconds: 3,
    attempts: 10,
    faults: [{ kind: 'disconnect', at: 3, forMs: 6000 }],
  })

  expect(result.attempts.map(attempt => [attempt.outcome, attempt.message])).toEqual([
    ['saved', null],
    ['saved', null],
    ['saved', null],
    ['uncertain', 'indiserver connection lost before the driver answered'],
  ])

  expect(result.frames).toHaveLength(3)
  expect([result.finalPhase, result.finalError]).toEqual(['failed', 'indiserver connection lost before the driver answered'])
  expect(result.alertChanges).toEqual([{ afterAttempts: 4, alerts: [{ id: 'run-failed', level: 'critical', message: 'The capture run failed' }] }])
})
