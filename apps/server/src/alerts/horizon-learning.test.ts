import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { observationsFilePath } from '../targets/horizon-observations.js'
import { createHorizon, horizonFilePath, writeHorizonProfile } from '../targets/horizon.js'
import { syntheticProfile } from '../targets/horizon.fixture.js'
import { createAlertMonitor, type AlertMonitor, type RunStart } from './monitor.js'
import { starStatistics } from './test-statistics.js'
import type { MountReading } from './rules.js'
import { defaultThresholds } from './thresholds.js'

/** Latitude 40, hour angle 0, declination -20: due south at altitude 30. Synthetic bins are 4 degrees: south is bin 45. */
const southAt30: MountReading = {
  tracking: true,
  slewing: false,
  parked: false,
  rightAscensionHours: 5,
  declinationDegrees: -20,
  siderealTimeHours: 5,
  latitudeDegrees: 40,
  pierSide: 'west',
}

const directories: string[] = []

const monitors: AlertMonitor[] = []

/** The skyline reads a file when a run starts; a run is only judged once that read is done. */
const skylineLoads: Array<Promise<unknown>> = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(Date.parse('2026-10-18T03:00:00Z'))
})

afterEach(async () => {
  for (const monitor of monitors.splice(0)) monitor.close()

  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })))
})

async function setup(profile: ReturnType<typeof syntheticProfile> | null, readMount: () => Promise<MountReading | null>) {
  const directory = await mkdtemp(join(tmpdir(), 'vela-horizon-learning-'))
  directories.push(directory)

  if (profile) await writeHorizonProfile(horizonFilePath(directory, 'fra-400')!, profile)

  const horizon = createHorizon(directory)
  const add = vi.spyOn(horizon.observations, 'add')
  const skyline = horizon.skyline

  horizon.skyline = rigId => {
    const load = skyline(rigId)

    skylineLoads.push(load)

    return load
  }

  const monitor = createAlertMonitor({
    rigId: 'fra-400',
    rigName: 'FRA 400',
    thresholds: defaultThresholds,
    notifier: null,
    readMount,
    horizon,
  })

  monitors.push(monitor)

  return { monitor, horizon, directory, add }
}

/** The south bin traced at the given altitude, everything else flat at 5. */
const southTreeAt = (altitude: number) =>
  syntheticProfile({
    altitudesDegrees: Array.from({ length: 90 }, (_, bin) => (bin === 45 ? altitude : 5)),
  })

const imaging: RunStart = { imaging: true }

/** A frame a minute: the mount is polled every 10 s in between, as in a real run. */
async function frame(monitor: AlertMonitor, stars: number, runId = 'run-1') {
  await vi.advanceTimersByTimeAsync(60_000)

  monitor.frameCaptured(
    { capturedAt: new Date(Date.now() - 60_000).toISOString(), statistics: starStatistics(stars, 2) },
    runId,
  )
}

async function startRun(monitor: AlertMonitor, start: RunStart = imaging) {
  monitor.runStarted(60, start)
  await Promise.all(skylineLoads.splice(0))
  await vi.advanceTimersByTimeAsync(0)
}

async function healthyFrames(monitor: AlertMonitor, count = 6, runId = 'run-1') {
  for (let index = 0; index < count; index++) await frame(monitor, 50, runId)
}

const collapsedMessage = (monitor: AlertMonitor) =>
  monitor.view().alerts.find(alert => alert.id === 'stars-collapsed')?.message

describe('an observed obstruction', () => {
  it('is recorded once per collapse, with where the mount pointed and the star counts before and at the drop', async () => {
    const { monitor, horizon, directory } = await setup(null, async () => southAt30)

    await startRun(monitor)
    await healthyFrames(monitor)
    const dropStarted = Date.now()
    await frame(monitor, 0)
    await frame(monitor, 0)
    await frame(monitor, 0)
    await frame(monitor, 0)

    expect(collapsedMessage(monitor)).toBeDefined()

    await vi.waitFor(async () => expect(await horizon.observations.list('fra-400')).toHaveLength(1))

    const [observation] = await horizon.observations.list('fra-400')

    expect(observation).toMatchObject({ strongBefore: 50, strongAt: 0, runId: 'run-1' })
    expect(observation!.altitudeDegrees).toBeCloseTo(30, 6)
    expect(observation!.azimuthDegrees).toBeCloseTo(180, 6)
    expect(Date.parse(observation!.at)).toBe(dropStarted)
    expect((await stat(observationsFilePath(directory, 'fra-400')!)).mode & 0o777).toBe(0o600)
  })

  it('is not recorded on a calibration run, which has no stars and is pointed nowhere', async () => {
    const { monitor, add } = await setup(null, async () => southAt30)

    await startRun(monitor, { imaging: false, calibration: true })

    for (const stars of [50, 50, 50, 50, 50, 0, 0, 0]) await frame(monitor, stars)

    expect(monitor.view().alerts).toEqual([])
    expect(add).not.toHaveBeenCalled()
  })

  it('is not recorded on a run that does not save its frames: defocus loses stars too', async () => {
    const { monitor, add } = await setup(null, async () => southAt30)

    await startRun(monitor, { imaging: false })
    await healthyFrames(monitor)
    await frame(monitor, 0)
    await frame(monitor, 0)

    expect(collapsedMessage(monitor)).toBeDefined()
    expect(add).not.toHaveBeenCalled()
  })

  it('is not recorded while the mount was slewing, even for one reading of the exposure', async () => {
    let reading: MountReading = southAt30
    const { monitor, add } = await setup(null, async () => reading)

    await startRun(monitor)
    await healthyFrames(monitor)

    reading = { ...southAt30, slewing: true }
    await vi.advanceTimersByTimeAsync(10_000)
    reading = southAt30
    await frame(monitor, 0)

    await frame(monitor, 0)

    expect(collapsedMessage(monitor)).toBeDefined()
    expect(add).not.toHaveBeenCalled()
  })

  it('is not recorded without a mount reading, with one that cannot give a position, or after reads failed', async () => {
    for (const readMount of [
      async () => null,
      async () => ({ ...southAt30, latitudeDegrees: null }),
      async () => ({ ...southAt30, slewing: null }),
    ]) {
      const { monitor, add } = await setup(null, readMount)

      await startRun(monitor)
      await healthyFrames(monitor)
      await frame(monitor, 0)
      await frame(monitor, 0)

      expect(collapsedMessage(monitor)).toBeDefined()
      expect(add).not.toHaveBeenCalled()
    }

    let failing = false

    const { monitor, add } = await setup(null, async () => {
      if (failing) throw new Error('timed out')

      return southAt30
    })

    await startRun(monitor)
    await healthyFrames(monitor)
    failing = true
    await frame(monitor, 0)
    failing = false
    await frame(monitor, 0)
    expect(add).not.toHaveBeenCalled()
  })

  it('is not recorded for a mount pointed at or below the horizon', async () => {
    const { monitor, add } = await setup(null, async () => ({ ...southAt30, declinationDegrees: -60 }))

    await startRun(monitor)
    await healthyFrames(monitor)
    await frame(monitor, 0)
    await frame(monitor, 0)

    expect(collapsedMessage(monitor)).toBeDefined()
    expect(add).not.toHaveBeenCalled()
  })

  it('is not recorded for a dropping or declining count that never collapsed', async () => {
    const { monitor, add } = await setup(null, async () => southAt30)

    await startRun(monitor)
    await healthyFrames(monitor)

    for (const stars of [20, 20, 20]) await frame(monitor, stars)

    expect(monitor.view().alerts.map(alert => alert.id)).toContain('stars-dropping')
    expect(collapsedMessage(monitor)).toBeUndefined()
    expect(add).not.toHaveBeenCalled()
  })

  it('leaves the alert as it was when the file cannot be written, and warns once without values', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { monitor, horizon } = await setup(null, async () => southAt30)

    vi.spyOn(horizon.observations, 'add').mockRejectedValue(new Error('disk full at 30.0 180.0'))

    await startRun(monitor)
    await healthyFrames(monitor)
    await frame(monitor, 0)
    await frame(monitor, 0)
    await frame(monitor, 0)

    expect(collapsedMessage(monitor)).toBeDefined()
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls.flat().join('\n')).not.toMatch(/\d{2}\.\d|disk full/)
  })
})

describe('behind the trees', () => {
  it('names the trees when the mount points behind a traced skyline', async () => {
    const { monitor } = await setup(southTreeAt(40), async () => southAt30)

    await startRun(monitor)
    await healthyFrames(monitor)
    await frame(monitor, 0)
    await frame(monitor, 0)

    expect(collapsedMessage(monitor)).toMatch(/, behind the trees$/)
  })

  it('leaves the cause alone above the skyline, and without a profile', async () => {
    for (const profile of [southTreeAt(20), null]) {
      const { monitor } = await setup(profile, async () => southAt30)

      await startRun(monitor)
      await healthyFrames(monitor)
      await frame(monitor, 0)
      await frame(monitor, 0)

      expect(collapsedMessage(monitor)).toBeDefined()
      expect(collapsedMessage(monitor)).not.toContain('behind the trees')
    }
  })

  it('does not name the trees without a frame pointing, even behind the skyline', async () => {
    const { monitor } = await setup(southTreeAt(40), async () => ({ ...southAt30, slewing: true }))

    await startRun(monitor)
    await healthyFrames(monitor)
    await frame(monitor, 0)
    await frame(monitor, 0)

    expect(collapsedMessage(monitor)).not.toContain('behind the trees')
  })

  it('does not let the record a collapse made rename that collapse, but names the trees on the next run', async () => {
    const { monitor, horizon } = await setup(southTreeAt(20), async () => southAt30)

    await startRun(monitor)
    await healthyFrames(monitor)
    await frame(monitor, 0)
    await frame(monitor, 0)
    await vi.waitFor(async () => expect(await horizon.observations.list('fra-400')).toHaveLength(1))

    await frame(monitor, 0)
    await frame(monitor, 0)
    expect(collapsedMessage(monitor)).not.toContain('behind the trees')

    monitor.runEnded('stopped')
    await startRun(monitor)
    await healthyFrames(monitor, 6, 'run-2')
    await frame(monitor, 0, 'run-2')
    await frame(monitor, 0, 'run-2')

    expect(collapsedMessage(monitor)).toMatch(/, behind the trees$/)
  })

  it('forgets deleted observations on the next run', async () => {
    const { monitor, horizon } = await setup(southTreeAt(20), async () => southAt30)

    await horizon.observations.add('fra-400', {
      at: '2026-10-17T03:00:00.000Z',
      altitudeDegrees: 35,
      azimuthDegrees: 181,
      strongBefore: 50,
      strongAt: 0,
      runId: 'earlier',
    })

    await startRun(monitor)
    await healthyFrames(monitor)
    await frame(monitor, 0)
    await frame(monitor, 0)
    expect(collapsedMessage(monitor)).toMatch(/, behind the trees$/)

    await vi.waitFor(async () => expect(await horizon.observations.list('fra-400')).toHaveLength(2))

    for (const observation of await horizon.observations.list('fra-400'))
      await horizon.observations.remove('fra-400', observation.id)

    monitor.runEnded('stopped')
    await vi.advanceTimersByTimeAsync(6 * 60_000)

    await startRun(monitor)
    await healthyFrames(monitor, 6, 'run-2')
    await frame(monitor, 0, 'run-2')
    await frame(monitor, 0, 'run-2')

    expect(collapsedMessage(monitor)).not.toContain('behind the trees')
  })
})
