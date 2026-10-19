import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { openCriaCheckout, type CriaCheckout } from './cria-checkout.ts'
import { runScenario } from './scenario.ts'
import { localSiderealHours } from './sidereal.ts'
import { synthesizeTape } from './tape.ts'

const mount = 'Synthetic Mount'

const exposureSeconds = 4

const gapSeconds = 240

const frames = 16

const attempts = 14

const stopAt = 7

const longitude = 20

const startAt = Date.UTC(2030, 0, 1, 2)

// The first frame arrives 100 ms after its exposure, which starts 1 s into the recording.
const firstFrameAt = startAt + 1000 + exposureSeconds * 1000 + 100

// West of the meridian by 0.4 h at the first frame; each frame is 244 s of sky later.
const raHours = localSiderealHours(firstFrameAt, longitude) + 0.4

let cria: CriaCheckout

let scratch: string

let tape: string

beforeAll(async () => {
  cria = await openCriaCheckout(process.env.CRIA_CHECKOUT)
  scratch = await mkdtemp(join(tmpdir(), 'am5-meridian-'))
  tape = await synthesizeTape(
    cria,
    {
      mount,
      sensor: { width: 160, height: 128 },
      exposureSeconds,
      gapSeconds,
      stars: Array(frames).fill(12),
      site: { latitudeDegrees: 10, longitudeDegrees: longitude },
      startAt,
      pierSide: 'west',
      pointing: { raHours: raHours % 24, decDegrees: 20 },
    },
    scratch,
  )
})

afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true })
})

test('an AM5 on the pre-meridian side runs out of sky: meridian-near, meridian-imminent, then the mount stops tracking', async () => {
  const result = await runScenario(tape, {
    cria,
    exposureSeconds,
    attempts,
    faults: [{ kind: 'set', at: stopAt, device: mount, property: 'TELESCOPE_TRACK_STATE', values: { TRACK_ON: false, TRACK_OFF: true } }],
  })

  expect(result.frames.map(frame => frame.statistics?.detectedStars)).toEqual(Array(attempts).fill(12))
  expect(result.alertChanges.map(change => change.alerts.map(alert => alert.id))).toEqual([
    ['meridian-near'],
    ['meridian-imminent'],
    ['meridian-imminent', 'tracking-stopped'],
  ])

  const [near, imminent, stopped] = result.alertChanges

  // Seen at the mount's 10 s poll, so it names the minutes left at that poll, between the 20 that raise it and the 5 that make it imminent.
  const minutes = Number(/^Tracking stops in about (\d+) min at the meridian; re-slew or flip$/.exec(near!.alerts[0]!.message)?.[1])

  expect(near!.alerts[0]!.level).toBe('warn')
  expect(minutes).toBeGreaterThan(5)
  expect(minutes).toBeLessThanOrEqual(20)
  expect(imminent!.alerts[0]).toEqual({ id: 'meridian-imminent', level: 'critical', message: 'The mount is at its meridian tracking limit; re-slew or flip now' })
  expect(stopped!.alerts[1]).toEqual({ id: 'tracking-stopped', level: 'critical', message: 'The mount has stopped tracking' })

  // The limit is 20 minutes away at frame 2 (0.4 h + 0.0669 h of path, 0.068 h per frame), and the fault starts at frame 7.
  expect(near!.afterAttempts).toBeGreaterThanOrEqual(2)
  expect(stopped!.afterAttempts).toBeGreaterThanOrEqual(stopAt)
})
