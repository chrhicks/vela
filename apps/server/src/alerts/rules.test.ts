import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  evaluateAlerts,
  type AlertId,
  type Frame,
  type MountReading,
  type RigHistory,
  type RunState,
  type SkyPoint,
} from './rules.js'
import type { FrameEvidence } from './cause.js'
import { defaultThresholds, thresholdsSchema, type AlertThresholds } from './thresholds.js'

function fixture(name: string) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

const running: RunState = { status: 'running', exposureSeconds: 60, waitingForFrameSince: 0, imaging: true }

function history(parts: Partial<RigHistory>): RigHistory {
  return { run: running, frames: [], mountReadings: [], observationsInterruptedSince: null, ...parts }
}

function ids(h: RigHistory, now = 0, thresholds: AlertThresholds = defaultThresholds) {
  return evaluateAlerts(h, thresholds, now).conditions.map(condition => condition.id)
}

// ---------------------------------------------------------------------------
// The 2026-10-17 night, frame by frame

const night: Array<Frame & { time: string }> = JSON.parse(fixture('night-20261018-frames.json')).map(
  (row: { capturedAt: string; stars: number; hfrPixels: number | null }) => ({
    time: row.capturedAt.slice(11, 19),
    capturedAt: Date.parse(row.capturedAt),
    stars: row.stars,
    hfrPixels: row.hfrPixels,
  }),
)

/** What the rules say right after each frame arrives, for a run that began with the first frame given. */
function replay(frames: typeof night) {
  return frames.map((frame, index) => {
    const seen = frames.slice(0, index + 1)
    const run: RunState = { status: 'running', exposureSeconds: 60, waitingForFrameSince: frame.capturedAt, imaging: true }

    return { time: frame.time, ids: ids(history({ run, frames: seen }), frame.capturedAt) }
  })
}

function firstRaised(id: AlertId, steps: ReturnType<typeof replay>) {
  return steps.find(step => step.ids.includes(id))?.time
}

const healthyBeforeSnag = night.filter(f => f.time >= '02:27:54' && f.time <= '03:30:02')

const afterRecovery = night.filter(f => f.time >= '04:12:09')

const wholeRun = night.filter(f => f.time <= '05:11:23')

describe('the real night: camera snagged a tripod leg', () => {
  it('stays quiet on all 49 healthy frames before the snag (02:27:54Z-03:30:02Z)', () => {
    expect(healthyBeforeSnag).toHaveLength(49)
    expect(replay(healthyBeforeSnag).filter(step => step.ids.length > 0)).toEqual([])
  })

  it('raises stars-collapsed on the third frame of the snag, once the median and then its repeat agree', () => {
    const steps = replay(wholeRun)

    expect(firstRaised('stars-collapsed', steps)).toBe('03:33:25')
    expect(firstRaised('stars-dropping', steps)).toBe('03:33:25')
    expect(steps.find(step => step.time === '03:32:17')!.ids).toEqual([])
  })

  it('does not call the 1- and 2-star frames a focus problem', () => {
    const steps = replay(wholeRun)

    expect(firstRaised('hfr-high', steps)).toBeUndefined()
    expect(firstRaised('hfr-bad', steps)).toBeUndefined()
  })

  it('stays quiet on all 53 healthy frames after the recovery (04:12:09Z-05:11:23Z) in a fresh run', () => {
    expect(afterRecovery).toHaveLength(53)
    expect(replay(afterRecovery).filter(step => step.ids.length > 0)).toEqual([])
  })

  it('clears stars-collapsed once the median has been back above half the old baseline for two frames, with no trend alert left behind', () => {
    const steps = replay(wholeRun)
    const at = (time: string) => steps.find(step => step.time === time)!.ids

    // The median of 04:09:39 (133), 04:12:09 and 04:13:16 is the first to reach it; 04:14:24 is the second.
    expect(at('04:12:09')).toContain('stars-collapsed')
    expect(at('04:13:16')).toContain('stars-collapsed')
    expect(at('04:14:24')).toEqual([])
    expect(steps.filter(step => step.time >= '04:14:24').flatMap(step => step.ids)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The 2026-10-23 night: 90 s frames, counts that swing 2x with nothing wrong

const nightOf20261023: Record<string, Array<[capturedAt: string, stars: number, hfrPixels: number]>> = JSON.parse(
  fixture('night-20261023-frames.json'),
)

function framesFrom(target: string, from: string, to = '9999') {
  return nightOf20261023[target]!
    .filter(([capturedAt]) => capturedAt >= from && capturedAt < to)
    .map(([capturedAt, stars, hfrPixels]): Frame & { time: string } => ({
      time: capturedAt.slice(11, 19),
      capturedAt: Date.parse(capturedAt),
      stars,
      hfrPixels,
    }))
}

describe('the real night of 2026-10-23: star counts that swing without anything being wrong', () => {
  // Cria's frames before 00:00Z were a different focus, so each stretch is its own run.
  const heartRun = framesFrom('Heart Nebula', '2026-10-24T00:01')
  const heartFocusDrift = framesFrom('Heart Nebula', '2026-10-23T23:22', '2026-10-24T00:00')
  const northAmerica = framesFrom('North America Nebula', '2026-10-24T02:16')

  const quiet = (frames: typeof heartRun) => replay(frames).filter(step => step.ids.length > 0)

  it('stays quiet on the Heart run from 00:01Z until the haze, where one frame in 90 s dropped 40 to 60 percent', () => {
    const beforeHaze = heartRun.filter(frame => frame.time < '01:26:00')

    expect(beforeHaze).toHaveLength(52)
    expect(quiet(beforeHaze)).toEqual([])
  })

  it('stays quiet while the count rises 167 to 278 as the focus drifts out (23:22Z-23:54Z, HFR 1.55 to 2.12)', () => {
    expect(heartFocusDrift).toHaveLength(20)
    expect(quiet(heartFocusDrift)).toEqual([])
  })

  it('stays quiet through the whole North America run, whose counts wander between 127 and 325', () => {
    expect(northAmerica).toHaveLength(137)
    expect(quiet(northAmerica)).toEqual([])
  })

  it('warns of the drop during the 01:26Z-01:38Z haze, with the star shapes unchanged, and never calls it a collapse', () => {
    const steps = replay(heartRun)
    const raised = firstRaised('stars-dropping', steps)

    expect(raised).toBeDefined()
    expect(raised! >= '01:26:58' && raised! <= '01:38:21').toBe(true)
    expect(firstRaised('stars-collapsed', steps)).toBeUndefined()
    expect(firstRaised('hfr-high', steps)).toBeUndefined()
  })

  it('does not report the haze again as a slow decline once it has passed', () => {
    expect(firstRaised('stars-declining', replay(heartRun))).toBeUndefined()
  })

  it('keeps warning through the haze and stops once the median is back above half the baseline', () => {
    const steps = replay(heartRun)
    const during = steps.filter(step => step.time >= '01:30:12' && step.time <= '01:38:21')

    expect(during.map(step => step.ids)).toEqual(Array(during.length).fill(['stars-dropping']))
    expect(steps.find(step => step.time === '01:43:14')!.ids).toEqual([])
  })
})

describe('frame rules on short synthetic runs', () => {
  function runOf(stars: number[], hfrPixels: number | null = 3, everyMs = 60_000) {
    return stars.map((count, index): Frame => ({ capturedAt: index * everyMs, stars: count, hfrPixels }))
  }

  /** Counts by time instead of by frame, so the same sky can be sampled at different exposures. */
  function skyOf(count: (minute: number) => number, minutes: number, everyMs: number) {
    const frames: Frame[] = []

    for (let at = 0; at <= minutes * 60_000; at += everyMs)
      frames.push({ capturedAt: at, stars: count(at / 60_000), hfrPixels: 3 })

    return frames
  }

  const healthy = [1200, 1250, 1180, 1220, 1210]

  it('does not alert on one bad frame, or on two', () => {
    expect(ids(history({ frames: runOf([...healthy, 400]) }))).toEqual([])
    expect(ids(history({ frames: runOf([...healthy, 400, 400]) }))).toEqual([])
  })

  it('warns of a drop after the median has been low for two frames, and clears once it has recovered for two', () => {
    expect(ids(history({ frames: runOf([...healthy, 400, 400, 400]) }))).toEqual(['stars-dropping'])
    expect(ids(history({ frames: runOf([...healthy, 400, 400, 400, 1190]) }))).toEqual(['stars-dropping'])
    expect(ids(history({ frames: runOf([...healthy, 400, 400, 400, 1190, 1200]) }))).toEqual(['stars-dropping'])
    expect(ids(history({ frames: runOf([...healthy, 400, 400, 400, 1190, 1200, 1200]) }))).toEqual([])
  })

  it('ignores one very bad frame among good ones however low it goes', () => {
    expect(ids(history({ frames: runOf([...healthy, 0, 1200, 0, 1200, 3, 1200]) }))).toEqual([])
  })

  it('judges a fall by time, not frames: a slide that takes 40 minutes is no drop at 30 s or at 180 s', () => {
    const slide = (minute: number) => 1200 - Math.min(minute, 40) * 20

    for (const everyMs of [30_000, 180_000])
      expect(ids(history({ frames: skyOf(slide, 40, everyMs) }))).toEqual([])
  })

  it('judges a fall by time, not frames: a fall within a few minutes warns at 30 s and at 180 s', () => {
    const fall = (minute: number) => (minute < 20 ? 1200 : 300)

    for (const everyMs of [30_000, 180_000])
      expect(ids(history({ frames: skyOf(fall, 40, everyMs) }))).toContain('stars-dropping')
  })

  it('keeps a bad stretch out of the baseline so a long cloud cannot become normal', () => {
    const cloudy = runOf([...healthy, 300, 300, 300, 300, 300, 300])

    expect(ids(history({ frames: cloudy }))).toEqual(['stars-dropping'])
    expect(ids(history({ frames: runOf([...healthy, 60, 60, 60, 60, 60, 60]) }))).toEqual(
      expect.arrayContaining(['stars-dropping', 'stars-collapsed']),
    )
  })

  it('keeps frames from a dropping episode out of the baseline so a deeper drop still goes critical', () => {
    const thinningCloud = runOf([...Array<number>(10).fill(1000), 450, 450, 450, 100, 100, 100])

    expect(ids(history({ frames: thinningCloud }))).toEqual(['stars-dropping', 'stars-collapsed'])
  })

  it('raises stars-collapsed on a cloud-out whose counts go to a few stars for three frames', () => {
    expect(ids(history({ frames: runOf([...healthy, 6, 3, 0]) }))).toContain('stars-collapsed')
    expect(ids(history({ frames: runOf([...healthy, 6, 3]) }))).not.toContain('stars-collapsed')
  })

  it('counts an empty frame toward stars-collapsed at once, not after the median has caught up', () => {
    expect(ids(history({ frames: runOf([...healthy, 0]) }))).toEqual([])
    expect(ids(history({ frames: runOf([...healthy, 0, 0]) }))).toEqual(['stars-collapsed'])
  })

  it('words each star-count alert as the median now against what is normal', () => {
    const messages = (frames: number[]) =>
      evaluateAlerts(history({ frames: runOf(frames) }), defaultThresholds, 0).conditions.map(c => c.message)

    expect(messages([...healthy, 400, 400, 400])).toEqual(['Star count dropping: median 400 (normal ≈1210 stars)'])
    expect(messages([...healthy, 0, 0])).toEqual(['Star count fell to 0 (median 0, normal ≈1210 stars)'])
  })

  it('needs a full set of frames before it can see a fall', () => {
    expect(ids(history({ frames: runOf([1200, 1200, 10]) }))).toEqual([])
    expect(ids(history({ frames: runOf([1200, 1200, 1200, 400, 400, 400]) }))).toEqual(['stars-dropping'])
  })

  it('on a sparse field, ignores ratios and only reacts to an empty frame', () => {
    const sparse = [5, 6, 5, 5, 6]

    expect(ids(history({ frames: runOf([...sparse, 2, 2, 2]) }))).toEqual([])
    expect(ids(history({ frames: runOf([...sparse, 0]) }))).toEqual([])
    expect(ids(history({ frames: runOf([...sparse, 0, 0]) }))).toEqual(['stars-collapsed'])
  })

  it('has no star alert to give on a field with fewer than 3 stars, so it says there is no baseline', () => {
    expect(ids(history({ frames: runOf([2, 1, 2, 0, 0, 0]) }))).toEqual(['no-stars'])
  })

  it('warns when the last 30 minutes sit below 0.6 of the 30 before, and clears above 0.8', () => {
    const level = (before: number, after: number) => (minute: number) => (minute < 30 ? before : after)

    expect(ids(history({ frames: skyOf(level(1200, 700), 59, 60_000) }))).toEqual(['stars-declining'])
    expect(ids(history({ frames: skyOf(level(1200, 800), 59, 60_000) }))).toEqual([])
    expect(ids(history({ frames: skyOf(minute => (minute < 30 ? 1200 : minute < 60 ? 700 : 1200), 89, 60_000) }))).toEqual([])
  })

  it('judges a decline by time, not frames, at 30 s and at 180 s', () => {
    const halved = (minute: number) => (minute < 30 ? 1200 : 600)

    for (const everyMs of [30_000, 180_000])
      expect(ids(history({ frames: skyOf(halved, 59, everyMs) }))).toContain('stars-declining')
  })

  it('raises hfr-high then hfr-bad after two frames each, and clears with hysteresis', () => {
    const withHfr = (hfrs: Array<number | null>) =>
      hfrs.map((hfrPixels, index): Frame => ({ capturedAt: index * 60_000, stars: 1200, hfrPixels }))

    expect(ids(history({ frames: withHfr([3, 4.5]) }))).toEqual([])
    expect(ids(history({ frames: withHfr([3, 4.5, 4.5]) }))).toEqual(['hfr-high'])
    expect(ids(history({ frames: withHfr([3, 6.5, 6.5]) }))).toEqual(['hfr-high', 'hfr-bad'])
    expect(ids(history({ frames: withHfr([6.5, 6.5, 5.5]) }))).toEqual(['hfr-high', 'hfr-bad'])
    expect(ids(history({ frames: withHfr([6.5, 6.5, 4.9]) }))).toEqual(['hfr-high'])
    expect(ids(history({ frames: withHfr([6.5, 6.5, 4.9, 3.4]) }))).toEqual([])
  })

  it('does not count a frame with no HFR toward the two in a row', () => {
    const frames = [4.65, null, 4.98].map((hfrPixels, index): Frame => ({ capturedAt: index, stars: 1200, hfrPixels }))

    expect(ids(history({ frames }))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The mount, from the real polls

function mountReading(fields: Partial<MountReading>): MountReading {
  return {
    tracking: true,
    slewing: false,
    parked: false,
    rightAscensionHours: 12,
    declinationDegrees: 20,
    siderealTimeHours: 10,
    latitudeDegrees: 40,
    pierSide: 'west',
    ...fields,
  }
}

function numberOrNull(text: string | undefined) {
  return text ? Number(text) : null
}

const polls = fixture('night-20261018-mount.csv')
  .trim()
  .split('\n')
  .slice(1)
  .map(line => {
    const [utc, ra, , tracking, slewing, parked, pier, lst] = line.split(',')

    return {
      at: Date.parse(`${utc}Z`),
      time: utc!.slice(11),
      reading: {
        tracking: tracking === 'True',
        slewing: slewing === 'True',
        parked: parked === 'True',
        rightAscensionHours: numberOrNull(ra),
        declinationDegrees: null,
        siderealTimeHours: numberOrNull(lst),
        latitudeDegrees: null,
        pierSide: pier === 'east' || pier === 'west' ? pier : null,
      } satisfies MountReading,
    }
  })

function replayMount(extra: typeof polls = []) {
  const all = [...polls, ...extra]

  return all.map((poll, index) => ({
    time: poll.time,
    ids: ids(history({ mountReadings: all.slice(0, index + 1).map(p => p.reading) }), poll.at),
  }))
}

describe('the real night: the AM5 stops past the meridian', () => {
  const steps = replayMount()
  const stoppedPolls = polls.findIndex(poll => !poll.reading.tracking)

  it('stays quiet about tracking while the mount tracks (03:42:22Z-04:03:23Z)', () => {
    expect(stoppedPolls).toBeGreaterThan(100)
    expect(steps.slice(0, stoppedPolls).flatMap(step => step.ids)).not.toContain('tracking-stopped')
  })

  it('raises tracking-stopped on the second reading after the stop and clears when tracking returns', () => {
    expect(steps[stoppedPolls]!.ids).not.toContain('tracking-stopped')
    expect(steps[stoppedPolls + 1]!.ids).toContain('tracking-stopped')
    expect(steps.find(step => step.time === '04:10:33')!.ids).not.toContain('tracking-stopped')
    expect(steps.find(step => step.time === '04:10:23')!.ids).toContain('tracking-stopped')
  })

  it('warns 20 minutes before the stop and goes critical 5 minutes before', () => {
    const firstAt = (id: AlertId) => steps.find(step => step.ids.includes(id))?.time

    // The mount stopped at 04:03:33, so these are 20 and 5 minutes ahead of it.
    expect(firstAt('meridian-near')).toBe('03:43:32')
    expect(firstAt('meridian-imminent')).toBe('03:58:33')
  })

  it('goes quiet once the mount has flipped to the east pier side', () => {
    const afterFlip = steps.filter(step => step.time >= '04:08:43')

    expect(afterFlip.flatMap(step => step.ids).filter(id => id.startsWith('meridian'))).toEqual([])
  })
})

describe('tracking-stopped', () => {
  const steady = [mountReading({}), mountReading({})]
  const stopped = mountReading({ tracking: false })
  const calibration: RunState = { ...running, imaging: false, calibration: true }

  it('raises when tracking is false for 20 s of 10 s polls, and not on a single reading', () => {
    expect(ids(history({ mountReadings: [...steady, stopped] }))).not.toContain('tracking-stopped')
    expect(ids(history({ mountReadings: [...steady, stopped, stopped, stopped] }))).toContain('tracking-stopped')
  })

  it('never raises for a calibration run, which has no use for tracking', () => {
    const readings = [stopped, stopped, stopped, stopped]

    expect(ids(history({ run: calibration, mountReadings: readings }))).not.toContain('tracking-stopped')
    expect(ids(history({ run: { ...running, imaging: false }, mountReadings: readings }))).toContain('tracking-stopped')
  })

  it('ignores a mount that is slewing or parked', () => {
    const slewing = mountReading({ tracking: false, slewing: true })
    const parked = mountReading({ tracking: false, parked: true })

    expect(ids(history({ mountReadings: [...steady, slewing, slewing, slewing] }))).not.toContain('tracking-stopped')
    expect(ids(history({ mountReadings: [...steady, parked, parked, parked] }))).not.toContain('tracking-stopped')
  })

  it('stays raised through a slew and clears only when tracking returns', () => {
    const slewing = mountReading({ tracking: false, slewing: true })

    expect(ids(history({ mountReadings: [stopped, stopped, slewing] }))).toContain('tracking-stopped')
    expect(ids(history({ mountReadings: [stopped, stopped, slewing, mountReading({})] }))).not.toContain('tracking-stopped')
  })
})

// ---------------------------------------------------------------------------
// The meridian

function meridianIds(hourAngle: number, thresholds: AlertThresholds, fields: Partial<MountReading> = {}) {
  const reading = mountReading({ rightAscensionHours: 12, siderealTimeHours: 12 + hourAngle, ...fields })

  return ids(history({ mountReadings: [reading] }), 0, thresholds).filter(id => id.startsWith('meridian'))
}

describe('meridian watch', () => {
  it('with the AM5 default (0.0669 h) warns from 20 min and goes critical from 5 min before the stop', () => {
    expect(meridianIds(-0.3, defaultThresholds)).toEqual([])
    expect(meridianIds(-0.25, defaultThresholds)).toEqual(['meridian-near'])
    expect(meridianIds(-0.01, defaultThresholds)).toEqual(['meridian-near', 'meridian-imminent'])
  })

  it('with a 1.0 h limit the same minutes come an hour later', () => {
    const afterSetup = thresholdsSchema.parse({ meridianTrackLimitHours: 1.0 })

    expect(meridianIds(0.6, afterSetup)).toEqual([])
    expect(meridianIds(0.7, afterSetup)).toEqual(['meridian-near'])
    expect(meridianIds(0.95, afterSetup)).toEqual(['meridian-near', 'meridian-imminent'])
  })

  it('stays critical when the mount is already past its limit on the west pier', () => {
    expect(meridianIds(0.5, defaultThresholds)).toEqual(['meridian-near', 'meridian-imminent'])
  })

  it('wraps the hour angle across 0 h on the sidereal clock', () => {
    const reading = mountReading({ rightAscensionHours: 0.005, siderealTimeHours: 23.995 })

    expect(ids(history({ mountReadings: [reading] }))).toContain('meridian-imminent')
  })

  it('wraps the hour angle near +/-12 h instead of reading a distant target as past the meridian', () => {
    const upperSide = mountReading({ rightAscensionHours: 0.4, siderealTimeHours: 12.5 })
    const lowerSide = mountReading({ rightAscensionHours: 12.4, siderealTimeHours: 0.5 })

    expect(ids(history({ mountReadings: [upperSide] }))).toEqual([])
    expect(ids(history({ mountReadings: [lowerSide] }))).toEqual([])
  })

  it('has nothing to watch on the east pier side', () => {
    expect(meridianIds(0.5, defaultThresholds, { pierSide: 'east' })).toEqual([])
  })

  it.each([
    ['sidereal time', { siderealTimeHours: null }],
    ['right ascension', { rightAscensionHours: null }],
    ['pier side', { pierSide: null }],
    ['sidereal time, pier side', { siderealTimeHours: null, pierSide: null }],
  ] as const)('says the watch is unavailable, not silent, when %s is missing', (missing, fields) => {
    const result = evaluateAlerts(history({ mountReadings: [mountReading(fields)] }), defaultThresholds, 0)

    expect(result.unavailable).toEqual([`meridian watch unavailable: ${missing}`])
    expect(result.conditions).toEqual([])
  })

  it('says so when there are no mount readings at all, and says nothing when the watch is running', () => {
    expect(evaluateAlerts(history({}), defaultThresholds, 0).unavailable).toEqual([
      'meridian watch unavailable: mount readings',
    ])
    expect(evaluateAlerts(history({ mountReadings: [mountReading({})] }), defaultThresholds, 0).unavailable).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The run and the rig

describe('rig-unreachable', () => {
  it('raises once observations have been interrupted for more than 30 s, and reads current again afterwards', () => {
    expect(ids(history({ observationsInterruptedSince: 0 }), 30_000)).not.toContain('rig-unreachable')
    expect(ids(history({ observationsInterruptedSince: 0 }), 31_000)).toContain('rig-unreachable')
    expect(ids(history({ observationsInterruptedSince: null }), 31_000)).not.toContain('rig-unreachable')
  })
})

describe('frames-stalled', () => {
  it('raises after 2 x (exposure + 30 s) without a frame and clears when one arrives', () => {
    const waiting = (since: number): RunState => ({ status: 'running', exposureSeconds: 60, waitingForFrameSince: since, imaging: true })

    expect(ids(history({ run: waiting(0) }), 180_000)).not.toContain('frames-stalled')
    expect(ids(history({ run: waiting(0) }), 181_000)).toContain('frames-stalled')
    expect(ids(history({ run: waiting(181_000) }), 182_000)).not.toContain('frames-stalled')
  })
})

describe('no-stars', () => {
  const frames = (counts: number[]): Frame[] =>
    counts.map((stars, index) => ({ capturedAt: index * 60_000, stars, hfrPixels: null }))

  const idsFor = (counts: number[], run: RunState = running) => ids(history({ run, frames: frames(counts) }))

  it('raises on the fifth frame of a run that has had no stars, and not on the fourth', () => {
    expect(idsFor([0, 0, 0, 0])).not.toContain('no-stars')
    expect(idsFor([0, 0, 0, 0, 0])).toContain('no-stars')
  })

  it('says how many frames it waited and is critical', () => {
    const [condition] = evaluateAlerts(history({ frames: frames([0, 0, 0, 0, 0, 0, 0]) }), defaultThresholds, 0).conditions

    expect(condition).toEqual({ id: 'no-stars', level: 'critical', message: 'No stars after 5 frames' })
  })

  it('never raises once a baseline has formed', () => {
    expect(idsFor([40, 40, 40, 40, 40])).not.toContain('no-stars')
    expect(idsFor([40, 40, 40, 0, 0, 0, 0, 0, 0])).not.toContain('no-stars')
  })

  it('clears when a baseline forms after a cloudy start', () => {
    expect(idsFor([0, 0, 0, 0, 0])).toContain('no-stars')
    expect(idsFor([0, 0, 0, 0, 0, 90])).toContain('no-stars')
    expect(idsFor([0, 0, 0, 0, 0, 90, 90])).toContain('no-stars')
    expect(idsFor([0, 0, 0, 0, 0, 90, 90, 90])).not.toContain('no-stars')
  })

  it('stays quiet once a run that formed a baseline loses the sky, leaving that to stars-collapsed', () => {
    const found = idsFor([60, 60, 60, 60, 60, 0, 0, 0])

    expect(found).toContain('stars-collapsed')
    expect(found).not.toContain('no-stars')
  })

  it('never raises for a run that is not an imaging run', () => {
    const test: RunState = { status: 'running', exposureSeconds: 60, waitingForFrameSince: 0, imaging: false }

    expect(idsFor([0, 0, 0, 0, 0, 0, 0], test)).not.toContain('no-stars')
  })

  it('is raised by a lower noStarsFrames from alerts.json', () => {
    const quick = thresholdsSchema.parse({ noStarsFrames: 2 })

    expect(ids(history({ frames: frames([0, 0]) }), 0, quick)).toContain('no-stars')
    expect(ids(history({ frames: frames([0]) }), 0, quick)).not.toContain('no-stars')
  })

  it('clears with the run', () => {
    expect(idsFor([0, 0, 0, 0, 0], { status: 'stopped' })).toEqual([])
  })
})

describe('run state', () => {
  const trouble = history({
    observationsInterruptedSince: 0,
    frames: [1200, 1200, 1200, 0, 0].map((stars, index): Frame => ({ capturedAt: index, stars, hfrPixels: null })),
  })

  it('reports run-failed, and only that, when the run failed rather than being stopped', () => {
    const result = evaluateAlerts({ ...trouble, run: { status: 'failed' } }, defaultThresholds, 60_000)

    expect(result.conditions).toEqual([{ id: 'run-failed', level: 'critical', message: 'The capture run failed' }])
  })

  it('reports run-interrupted, and only that, when the server restarted during the run', () => {
    const run = { status: 'interrupted', message: 'Capture was interrupted' } as const
    const result = evaluateAlerts({ ...trouble, run }, defaultThresholds, 60_000)

    expect(result.conditions).toEqual([{ id: 'run-interrupted', level: 'critical', message: 'Capture was interrupted' }])
  })

  it('reports nothing once the run is stopped by the user', () => {
    expect(evaluateAlerts({ ...trouble, run: { status: 'stopped' } }, defaultThresholds, 60_000).conditions).toEqual([])
  })
})

describe('a calibration run', () => {
  const calibration: RunState = { ...running, imaging: false, calibration: true }

  const trouble = history({
    run: calibration,
    observationsInterruptedSince: 0,
    frames: [1200, 1200, 1200, 1200, 1200, 0, 0, 0, 0].map((stars, index): Frame => ({ capturedAt: index * 60_000, stars, hfrPixels: 9 })),
    mountReadings: [
      mountReading({ tracking: false, pierSide: 'west', siderealTimeHours: 12.2, rightAscensionHours: 12 }),
      mountReading({ tracking: false, pierSide: 'west', siderealTimeHours: 12.2, rightAscensionHours: 12 }),
      mountReading({ tracking: false, pierSide: 'west', siderealTimeHours: 12.2, rightAscensionHours: 12 }),
    ],
  })

  it('raises only the rig alerts, whatever the stars, the mount and the meridian say', () => {
    const light = ids({ ...trouble, run: { ...running, imaging: true } }, 600_000)

    expect(light).toEqual(expect.arrayContaining(['stars-dropping', 'hfr-bad', 'tracking-stopped', 'meridian-imminent']))
    expect(ids(trouble, 600_000)).toEqual(['rig-unreachable', 'frames-stalled'])
  })

  it('does not report the meridian watch as unavailable, which is not being watched', () => {
    expect(evaluateAlerts(history({ run: calibration }), defaultThresholds, 0).unavailable).toEqual([])
    expect(evaluateAlerts(history({ run: { ...running, imaging: false } }), defaultThresholds, 0).unavailable).not.toEqual([])
  })

  it('still reports run-failed and run-interrupted', () => {
    expect(ids({ ...trouble, run: { status: 'failed' } })).toEqual(['run-failed'])
    expect(ids({ ...trouble, run: { status: 'interrupted', message: 'x' } })).toEqual(['run-interrupted'])
  })
})

describe('levels', () => {
  it('gives each condition the level the spec assigns it', () => {
    const everything = evaluateAlerts(
      history({
        run: { status: 'running', exposureSeconds: 60, waitingForFrameSince: 0, imaging: true },
        frames: [[1200, 3], [1200, 3], [1200, 3], [0, 7], [0, 7], [0, 7]].map(
          ([stars, hfrPixels], index): Frame => ({ capturedAt: index, stars: stars!, hfrPixels: hfrPixels! }),
        ),
        mountReadings: [mountReading({ siderealTimeHours: 12 }), mountReading({ siderealTimeHours: 12, tracking: false }), mountReading({ siderealTimeHours: 12, tracking: false })],
        observationsInterruptedSince: 0,
      }),
      defaultThresholds,
      10 * 60_000,
    )

    const levels = Object.fromEntries(everything.conditions.map(condition => [condition.id, condition.level]))

    expect(levels).toEqual({
      'stars-dropping': 'warn',
      'stars-collapsed': 'critical',
      'hfr-high': 'warn',
      'hfr-bad': 'critical',
      'tracking-stopped': 'critical',
      'meridian-near': 'warn',
      'meridian-imminent': 'critical',
      'rig-unreachable': 'critical',
      'frames-stalled': 'warn',
    })
  })
})

describe('thresholds', () => {
  it('accepts an empty file as all defaults and overrides single numbers', () => {
    expect(thresholdsSchema.parse({})).toMatchObject({ starsSmoothingFrames: 3, starsDropFraction: 0.5, meridianTrackLimitHours: 0.0669 })
    expect(thresholdsSchema.parse({ meridianTrackLimitHours: 1 }).meridianTrackLimitHours).toBe(1)
  })

  it('rejects unknown keys and hysteresis that would flap', () => {
    expect(thresholdsSchema.safeParse({ starsLowRation: 0.5 }).success).toBe(false)
    expect(thresholdsSchema.safeParse({ hfrHighClearPixels: 4.5 }).success).toBe(false)
    expect(thresholdsSchema.safeParse({ starsCollapsedRatio: 0.6 }).success).toBe(false)
    expect(thresholdsSchema.safeParse({ starsLowRatio: 0.15 }).success).toBe(false)
  })
})

describe('the cause of a star alert', () => {
  const usual: FrameEvidence = { peaks: 500, blended: 15, sky: 680, axisRatio: 1.2 }

  /** Strong counts with the evidence each frame carried, one frame a minute. */
  function runOf(parts: Array<[stars: number, evidence?: Partial<FrameEvidence>]>) {
    return parts.map(([stars, change], index): Frame => ({
      capturedAt: index * 60_000,
      stars,
      hfrPixels: 3,
      evidence: { ...usual, ...change },
    }))
  }

  const healthy: Array<[number]> = [[100], [104], [98], [102], [100]]

  function messages(parts: Array<[stars: number, evidence?: Partial<FrameEvidence>]>) {
    return Object.fromEntries(
      evaluateAlerts(history({ frames: runOf(parts) }), defaultThresholds, 0).conditions.map(condition => [condition.id, condition.message]),
    )
  }

  it('says the sky brightened when a flash raised the sky and the stars fell', () => {
    const flash: Partial<FrameEvidence> = { sky: 7148, peaks: 56 }

    expect(messages([...healthy, [20, flash], [30], [25]])['stars-dropping']).toBe(
      'Star count dropping: median 25 (normal ≈100 stars), sky brightened',
    )
  })

  it('says few peaks when the peaks fell with the stars and the sky and shape are as usual', () => {
    const thin: Partial<FrameEvidence> = { peaks: 150 }

    expect(messages([...healthy, [30, thin], [28, thin], [25, thin]])['stars-dropping']).toMatch(/, few peaks$/)
  })

  it('names the cause on a collapse as well', () => {
    const smeared: Partial<FrameEvidence> = { peaks: 5000, blended: 4800, axisRatio: null }

    expect(messages([...healthy, [0, smeared], [0, smeared], [0, smeared]])['stars-collapsed']).toBe(
      'Star count fell to 0 (median 0, normal ≈100 stars), stars smeared or soft',
    )
  })

  it('names nothing when the evidence is as usual, and nothing without any evidence', () => {
    expect(messages([...healthy, [20], [30], [25]])['stars-dropping']).toBe('Star count dropping: median 25 (normal ≈100 stars)')

    const bare = [...healthy, [20], [30], [25]].map(([stars], index): Frame => ({ capturedAt: index * 60_000, stars: stars!, hfrPixels: 3 }))
    const [dropping] = evaluateAlerts(history({ frames: bare }), defaultThresholds, 0).conditions

    expect(dropping!.message).toBe('Star count dropping: median 25 (normal ≈100 stars)')
  })

  it('compares with frames no alert called bad, so a cloud does not become the normal sky', () => {
    const cloud: Partial<FrameEvidence> = { sky: 7148, peaks: 56 }
    const parts: Array<[number, Partial<FrameEvidence>?]> = [...healthy, [20, cloud], [20, cloud], [20, cloud], [20, cloud], [20, cloud], [20, cloud]]

    expect(messages(parts)['stars-dropping']).toMatch(/sky brightened$/)
  })
})

describe('the horizon in a star alert', () => {
  const usual: FrameEvidence = { peaks: 500, blended: 15, sky: 680, axisRatio: 1.2 }
  const tree = { altitudeDegrees: 20, azimuthDegrees: 200 }
  const open = { altitudeDegrees: 60, azimuthDegrees: 200 }

  /** One frame a minute: healthy ones, then the given strong counts, each pointed where `pointing` says. */
  function run(counts: number[], pointing: (index: number) => SkyPoint | null = () => open) {
    return [100, 104, 98, 102, 100, ...counts].map(
      (stars, index): Frame => ({ capturedAt: index * 60_000, stars, hfrPixels: 3, evidence: usual, pointing: pointing(index) }),
    )
  }

  const behind = (point: { altitudeDegrees: number }) => point.altitudeDegrees <= 30

  function conditions(frames: Frame[], horizon: Partial<Pick<RigHistory, 'behindSkyline'>> = { behindSkyline: behind }) {
    return evaluateAlerts(history({ frames, ...horizon }), defaultThresholds, 0).conditions
  }

  it('describes the frame where the collapse began, with the baseline before it', () => {
    const frames = run([0, 0, 0], index => (index === 5 ? tree : open))
    const collapsed = conditions(frames).find(condition => condition.id === 'stars-collapsed')!

    expect(collapsed.drop).toEqual({
      capturedAt: 5 * 60_000,
      strongBefore: 100,
      strongAt: 0,
      pointing: tree,
    })
  })

  it('takes the first of the confirming frames, not the one that raised it', () => {
    const collapsed = conditions(run([30, 30, 3, 2, 2]), {}).find(condition => condition.id === 'stars-collapsed')!

    expect(collapsed.drop).toMatchObject({ capturedAt: 8 * 60_000, strongBefore: 100, strongAt: 2 })
  })

  it('has no drop on any other alert', () => {
    for (const condition of conditions(run([0, 0, 0])))
      if (condition.id !== 'stars-collapsed') expect(condition.drop).toBeUndefined()
  })

  it('carries no pointing for a frame without one', () => {
    const collapsed = conditions(run([0, 0, 0], () => null)).find(condition => condition.id === 'stars-collapsed')!

    expect(collapsed.drop!.pointing).toBeNull()
  })

  it('names the trees when the latest frame was pointed behind the skyline', () => {
    const frames = run([20, 30, 25], index => (index >= 5 ? tree : open))
    const dropping = conditions(frames).find(condition => condition.id === 'stars-dropping')!

    expect(dropping.message).toBe('Star count dropping: median 25 (normal ≈100 stars), behind the trees')
  })

  it('names the trees over a cause the frames show, and on a collapse as well', () => {
    const flash = { ...usual, sky: 7148, peaks: 56 }
    const frames = run([0, 0, 0], () => tree).map((frame, index) => (index >= 5 ? { ...frame, evidence: flash } : frame))

    expect(conditions(frames).find(condition => condition.id === 'stars-collapsed')!.message).toMatch(/, behind the trees$/)
  })

  it('leaves the causes unchanged above the skyline, without pointing, and without a horizon', () => {
    const plain = run([20, 30, 25], () => null)

    const message = (frames: Frame[], horizon?: Partial<Pick<RigHistory, 'behindSkyline'>>) =>
      conditions(frames, horizon).find(condition => condition.id === 'stars-dropping')!.message

    expect(message(run([20, 30, 25], () => open))).toBe(message(plain))
    expect(message(plain)).toBe('Star count dropping: median 25 (normal ≈100 stars)')
    expect(message(run([20, 30, 25], () => tree), {})).toBe(message(plain))
    expect(message(plain, { behindSkyline: () => true })).toBe(message(plain))
  })
})

