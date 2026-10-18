import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  evaluateAlerts,
  type AlertId,
  type Frame,
  type MountReading,
  type RigHistory,
  type RunState,
} from './rules.js'
import { defaultThresholds, thresholdsSchema, type AlertThresholds } from './thresholds.js'

function fixture(name: string) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

const running: RunState = { status: 'running', exposureSeconds: 60, waitingForFrameSince: 0 }

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
    const run: RunState = { status: 'running', exposureSeconds: 60, waitingForFrameSince: frame.capturedAt }

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

  it('raises stars-low on the first bad frame and stars-collapsed on the second', () => {
    const steps = replay(wholeRun)

    expect(firstRaised('stars-low', steps)).toBe('03:31:10')
    expect(firstRaised('stars-collapsed', steps)).toBe('03:32:17')
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

  it('clears stars-collapsed once two frames in a row are back above 0.8 of the old baseline', () => {
    const steps = replay(wholeRun)
    const at = (time: string) => steps.find(step => step.time === time)!.ids

    expect(at('04:12:09')).toContain('stars-collapsed')
    // 969 stars is below 0.8 x 1214, so the 04:13:16 frame breaks the streak.
    expect(at('04:13:16')).toContain('stars-collapsed')
    expect(at('04:15:31')).toContain('stars-collapsed')
    expect(at('04:16:39')).toEqual([])
  })
})

describe('frame rules on short synthetic runs', () => {
  function runOf(stars: number[], hfrPixels: number | null = 3) {
    return stars.map((count, index): Frame => ({ capturedAt: index * 60_000, stars: count, hfrPixels }))
  }

  const healthy = [1200, 1250, 1180, 1220, 1210]

  it('treats one bad frame as a warning only, and clears it on the next good one', () => {
    expect(ids(history({ frames: runOf([...healthy, 400]) }))).toEqual(['stars-low'])
    expect(ids(history({ frames: runOf([...healthy, 400, 1190]) }))).toEqual([])
  })

  it('keeps a bad frame out of the baseline so a long cloud cannot become normal', () => {
    const cloudy = runOf([...healthy, 300, 300, 300, 300, 300, 300])

    expect(ids(history({ frames: cloudy }))).toEqual(expect.arrayContaining(['stars-low', 'stars-collapsed']))
  })

  it('needs at least three frames before it has a baseline', () => {
    expect(ids(history({ frames: runOf([1200, 1200, 10]) }))).toEqual([])
    expect(ids(history({ frames: runOf([1200, 1200, 1200, 10]) }))).toEqual(['stars-low'])
  })

  it('on a sparse field, ignores ratios and only reacts to an empty frame', () => {
    const sparse = [5, 6, 5, 5, 6]

    expect(ids(history({ frames: runOf([...sparse, 2]) }))).toEqual([])
    expect(ids(history({ frames: runOf([...sparse, 0]) }))).toEqual([])
    expect(ids(history({ frames: runOf([...sparse, 0, 0]) }))).toEqual(['stars-collapsed'])
  })

  it('does not alert on an empty field when the baseline is below 3 stars', () => {
    expect(ids(history({ frames: runOf([2, 1, 2, 0, 0, 0]) }))).toEqual([])
  })

  it('warns when the last five frames fall below 0.7 of the five before, and clears above 0.85', () => {
    const sliding = [1200, 1200, 1200, 1200, 1200, 1000, 900, 800, 780, 760]
    const recovering = [...sliding, 1200, 1200, 1200, 1200, 1200]

    expect(ids(history({ frames: runOf(sliding) }))).toEqual(['stars-declining'])
    expect(ids(history({ frames: runOf(recovering) }))).toEqual([])
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
    siderealTimeHours: 10,
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
        siderealTimeHours: numberOrNull(lst),
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

  it('raises when tracking is false for 20 s of 10 s polls, and not on a single reading', () => {
    expect(ids(history({ mountReadings: [...steady, stopped] }))).not.toContain('tracking-stopped')
    expect(ids(history({ mountReadings: [...steady, stopped, stopped, stopped] }))).toContain('tracking-stopped')
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
    const waiting = (since: number): RunState => ({ status: 'running', exposureSeconds: 60, waitingForFrameSince: since })

    expect(ids(history({ run: waiting(0) }), 180_000)).not.toContain('frames-stalled')
    expect(ids(history({ run: waiting(0) }), 181_000)).toContain('frames-stalled')
    expect(ids(history({ run: waiting(181_000) }), 182_000)).not.toContain('frames-stalled')
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

  it('reports nothing once the run is stopped by the user', () => {
    expect(evaluateAlerts({ ...trouble, run: { status: 'stopped' } }, defaultThresholds, 60_000).conditions).toEqual([])
  })
})

describe('levels', () => {
  it('gives each condition the level the spec assigns it', () => {
    const everything = evaluateAlerts(
      history({
        run: { status: 'running', exposureSeconds: 60, waitingForFrameSince: 0 },
        frames: [[1200, 3], [1200, 3], [1200, 3], [0, 7], [0, 7]].map(
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
      'stars-low': 'warn',
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
    expect(thresholdsSchema.parse({})).toMatchObject({ starsLowRatio: 0.6, meridianTrackLimitHours: 0.0669 })
    expect(thresholdsSchema.parse({ meridianTrackLimitHours: 1 }).meridianTrackLimitHours).toBe(1)
  })

  it('rejects unknown keys and hysteresis that would flap', () => {
    expect(thresholdsSchema.safeParse({ starsLowRation: 0.5 }).success).toBe(false)
    expect(thresholdsSchema.safeParse({ hfrHighClearPixels: 4.5 }).success).toBe(false)
    expect(thresholdsSchema.safeParse({ starsCollapsedRatio: 0.7 }).success).toBe(false)
  })
})
