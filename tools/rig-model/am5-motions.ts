import type { PropertyState } from '@vela/rig-events'
import type { Command, MountEvent } from './am5-events.ts'

export type MeasureName = 'stopLatencyS' | 'overshootArcsec' | 'landingArcsec' | 'coastS' | 'coastArcsec' | 'speedArcsecPerS'

export interface Motion {
  /** `goto`, `home`, `rate-move 9x`, `abort of home`, `abort of rate-move 9x`. */
  readonly group: string
  /** Seconds since the recording's first event. */
  readonly at: number
  readonly measures: Partial<Record<MeasureName, number | undefined>>
}

export interface Skipped {
  readonly at: number
  readonly what: string
  readonly reason: string
}

export interface Analysis {
  readonly motions: Motion[]
  readonly skipped: Skipped[]
  /** Gaps between two consecutive readings that both show movement, in milliseconds. */
  readonly readingIntervalsMs: number[]
}

/** A reading that moved more than this many display steps (after removing sidereal drift) counts as movement. */
const movementSteps = 1.5

/** The mount must be seen still for this many poll periods before a stop counts as finished. */
const quietPolls = 1.5

/** A goto's approach is measured from the last reading farther than this from the target. Arcseconds. */
const farArcsec = 3600

/** A rate move's speed can be taken from its start command and one reading only if that reading came at least this long after the start. */
const minimumWaitMs = 500

const siderealHoursPerSecond = 1.0027379093 / 3600

const arcsecPerHour = 15 * 3600

interface Sample {
  readonly at: number
  readonly state: PropertyState
  readonly raHours: number
  readonly decDegrees: number
  /** Position with sidereal drift removed, so a mount at rest does not move. Arcseconds of axis angle: RA hours times 15 times 3600, with no cos(dec), so the numbers do not depend on where the mount points. */
  readonly x: number
  readonly y: number
  readonly moved: boolean
}

interface Point {
  readonly at: number
  readonly x: number
  readonly y: number
}

type Display = Extract<MountEvent, { type: 'steps' }>

type Located = { readonly command: Command; readonly at: number }

const wrapHours = (hours: number) => ((((hours + 12) % 24) + 24) % 24) - 12

/** Index of the first sample with `at >= time`. */
function lowerBound(samples: readonly Sample[], time: number): number {
  let low = 0
  let high = samples.length

  while (low < high) {
    const middle = (low + high) >> 1

    if (samples[middle]!.at < time) low = middle + 1
    else high = middle
  }

  return low
}

const between = (samples: readonly Sample[], from: number, to: number) => samples.slice(lowerBound(samples, from + 1), lowerBound(samples, to))

const before = (samples: readonly Sample[], time: number): Sample | undefined => samples[lowerBound(samples, time) - 1]

const last = <T>(items: readonly T[]) => items[items.length - 1]

function samplesOf(events: readonly MountEvent[], steps: { raHours: number; decDegrees: number }, intervals: number[]): Sample[] {
  const samples: Sample[] = []
  let trackingOff = false
  let previousOff = false

  for (const event of events) {
    if (event.type === 'tracking') trackingOff = !event.on

    if (event.type !== 'position') continue

    const previous = last(samples)

    if (previous === undefined) {
      samples.push({ ...event, x: 0, y: 0, moved: false })
      previousOff = trackingOff
      continue
    }

    const drift = trackingOff && previousOff ? siderealHoursPerSecond * ((event.at - previous.at) / 1000) : 0
    const deltaRa = wrapHours(event.raHours - previous.raHours - drift)
    const deltaDec = event.decDegrees - previous.decDegrees
    const moved = Math.abs(deltaRa) > movementSteps * steps.raHours || Math.abs(deltaDec) > movementSteps * steps.decDegrees

    if (moved && previous.moved) intervals.push(event.at - previous.at)

    samples.push({ ...event, x: previous.x + deltaRa * arcsecPerHour, y: previous.y + deltaDec * 3600, moved })
    previousOff = trackingOff
  }

  return samples
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** Where the mount had got to at `time`, if it kept the speed of its last two points. */
function extrapolate(from: Point, velocity: { x: number; y: number }, time: number): Point {
  const seconds = (time - from.at) / 1000

  return { at: time, x: from.x + velocity.x * seconds, y: from.y + velocity.y * seconds }
}

export function analyse(events: readonly MountEvent[], startedAt: number): Analysis {
  const steps = events.find((event): event is Display => event.type === 'steps')

  if (steps === undefined) throw new Error('The recording never defines the mount position, so its display step is unknown')

  const readingIntervalsMs: number[] = []
  const samples = samplesOf(events, steps, readingIntervalsMs)
  const commands: Located[] = events.flatMap(event => (event.type === 'command' ? [{ command: event.command, at: event.at }] : []))
  const gaps = events.flatMap(event => (event.type === 'gap' ? [event.at] : []))
  const endAt = events.findLast(event => event.type === 'end' || event.type === 'position')?.at ?? startedAt
  const rates = events.flatMap(event => (event.type === 'rate' ? [event] : []))
  const motions: Motion[] = []
  const skipped: Skipped[] = []

  const quietMs = quietPolls * 1000
  const second = (time: number) => Math.round(((time - startedAt) / 1000) * 10) / 10
  const rateAt = (time: number) => rates.findLast(rate => rate.at <= time)?.name ?? 'unknown rate'
  const skip = (at: number, what: string, reason: string) => skipped.push({ at: second(at), what, reason })
  const record = (at: number, group: string, measures: Motion['measures']) => motions.push({ group, at: second(at), measures })

  const arcsecAt = (sample: Sample, target: { raHours: number; decDegrees: number }) => ({
    x: wrapHours(sample.raHours - target.raHours) * arcsecPerHour,
    y: (sample.decDegrees - target.decDegrees) * 3600,
  })

  /** Why the mount was not seen at rest before `bound`, or `undefined` if it was. */
  function unsettled(lastMoved: Sample | undefined, from: number, bound: number, next: Located | undefined): string | undefined {
    if (gaps.some(gap => gap >= from && gap <= bound)) return 'the recording has a gap'

    if (bound - (lastMoved?.at ?? from) >= quietMs) return undefined

    return next === undefined ? 'the recording ended before the mount was seen at rest' : `${next.command.kind} came ${((next.at - (lastMoved?.at ?? from)) / 1000).toFixed(1)} s after the mount last moved`
  }

  /** Coast: how long and how far the position kept changing after the property reported it was not moving. */
  function coastOf(idle: Point | undefined, lastMoved: Sample | undefined): Partial<Record<MeasureName, number>> {
    if (idle === undefined) return {}

    if (lastMoved === undefined || lastMoved.at <= idle.at) return { coastS: 0, coastArcsec: 0 }

    return { coastS: (lastMoved.at - idle.at) / 1000, coastArcsec: distance(lastMoved, idle) }
  }

  /** A goto or a home: it ends itself, and the property says when. */
  function selfEnding(index: number, what: 'goto' | 'home') {
    const { command, at } = commands[index]!
    const next = commands[index + 1]
    const bound = next?.at ?? endAt
    const after = between(samples, at, bound)
    const done = after.find(sample => sample.state === 'Alert' || (what === 'goto' ? sample.state !== 'Busy' : sample.state === 'Idle'))

    if (done?.state === 'Alert') return skip(at, what, 'the property reported Alert')

    if (done === undefined) {
      if (next?.command.kind === 'abort') return

      return skip(at, what, next === undefined ? 'the recording ended before the property reported done' : `${next.command.kind} came before the property reported done`)
    }

    const lastMoved = last(after.filter(sample => sample.moved))

    if (next?.command.kind === 'abort' && lastMoved !== undefined && next.at - lastMoved.at < quietMs) return

    const reason = unsettled(lastMoved, at, bound, next)

    const coast = reason === undefined ? coastOf(done, lastMoved) : {}

    if (reason !== undefined) skip(at, `${what} coast`, reason)

    if (what === 'home') {
      if (lastMoved === undefined) return skip(at, what, 'the position never changed')

      return record(at, 'home', { coastS: coast.coastS })
    }

    if (command.kind !== 'goto') return

    const start = before(samples, at)
    const path = [...(start === undefined ? [] : [start]), ...after.slice(0, after.indexOf(done) + 1)].map(sample => arcsecAt(sample, command))
    const far = path.findLastIndex(offset => Math.hypot(offset.x, offset.y) > farArcsec)
    const side = path[far]
    const overshoot = side === undefined ? undefined : Math.max(0, ...path.slice(far + 1).flatMap(offset => [-Math.sign(side.x) * offset.x, -Math.sign(side.y) * offset.y]))
    const landed = arcsecAt(done, command)

    record(at, 'goto', { overshootArcsec: overshoot, landingArcsec: Math.hypot(landed.x, landed.y), ...coast })
  }

  /** How fast the mount was going at the stop, from its last two readings, or why that cannot be told. */
  function velocityAt(start: Located, stop: Located, requireTwo: boolean): { velocity: Point; speed: number; through: Sample; steady: boolean } | { reason: string } {
    const origin = before(samples, start.at)
    const moving = between(samples, start.at, stop.at)
    const through = last(moving)

    if (origin === undefined || through === undefined) return { reason: 'no reading before the stop to give the mount speed' }

    if (moving.length < 2 && requireTwo) return { reason: 'one reading before the stop, too few to give the mount speed' }

    if (moving.length < 2 && through.at - start.at < minimumWaitMs) return { reason: `the only reading came ${((through.at - start.at) / 1000).toFixed(2)} s after the move started, before the mount was at speed` }

    const from: Point = moving.length >= 2 ? moving[moving.length - 2]! : { at: start.at, x: origin.x, y: origin.y }
    const seconds = (through.at - from.at) / 1000
    const velocity = { at: through.at, x: (through.x - from.x) / seconds, y: (through.y - from.y) / seconds }
    const speed = Math.hypot(velocity.x, velocity.y)

    return speed === 0 ? { reason: 'the mount was not moving at the stop' } : { velocity, speed, through, steady: moving.length >= 2 }
  }

  /** A rate move stopped by its switch going off, or any motion stopped by an abort. */
  function stopped(startIndex: number, stopIndex: number, group: string, requireTwo: boolean) {
    const start = commands[startIndex]!
    const stop = commands[stopIndex]!
    const next = commands[stopIndex + 1]
    const bound = next?.at ?? endAt
    const post = between(samples, stop.at - 1, bound)
    const lastMoved = last(post.filter(sample => sample.moved))
    const reason = unsettled(lastMoved, stop.at, bound, next)

    if (reason !== undefined) return skip(stop.at, group, reason)

    if (lastMoved === undefined) return skip(stop.at, group, 'the position never changed after the stop')

    const stopLatencyS = (lastMoved.at - stop.at) / 1000
    const speed = velocityAt(start, stop, requireTwo)

    if ('reason' in speed) {
      skip(stop.at, `${group} overshoot and coast`, speed.reason)

      return record(stop.at, group, { stopLatencyS })
    }

    const atStop = extrapolate(speed.through, speed.velocity, stop.at)
    const travelled = ((lastMoved.x - atStop.x) * speed.velocity.x + (lastMoved.y - atStop.y) * speed.velocity.y) / speed.speed
    const idle = speed.through.state === 'Idle' ? atStop : post.find(sample => sample.state === 'Idle')

    record(stop.at, group, { stopLatencyS, overshootArcsec: travelled, speedArcsecPerS: speed.steady ? speed.speed : undefined, ...coastOf(idle, lastMoved) })
  }

  const gapped = (from: number, to: number) => gaps.some(gap => gap >= from && gap <= to)

  commands.forEach(({ command, at }, index) => {
    const next = commands[index + 1]

    switch (command.kind) {
      case 'goto':
      case 'home':
        return selfEnding(index, command.kind)
      case 'move-start': {
        const rate = `rate-move ${rateAt(at)}`

        if (next?.command.kind === 'move-stop') return gapped(at, next.at) ? skip(next.at, rate, 'the recording has a gap') : stopped(index, index + 1, rate, false)

        return skip(at, rate, next === undefined ? 'the recording ended before the move was stopped' : `${next.command.kind} came before the move was stopped`)
      }

      case 'abort': {
        const previous = commands[index - 1]
        const lastMoved = last(between(samples, previous?.at ?? at, at).filter(sample => sample.moved))
        const moving = previous !== undefined && ['goto', 'home', 'move-start'].includes(previous.command.kind) && lastMoved !== undefined && at - lastMoved.at < quietMs

        if (!moving) return skip(at, 'abort', 'nothing was moving')

        const kind = previous.command.kind === 'move-start' ? `rate-move ${rateAt(previous.at)}` : previous.command.kind

        return gapped(previous.at, at) ? skip(at, `abort of ${kind}`, 'the recording has a gap') : stopped(index - 1, index, `abort of ${kind}`, true)
      }

      case 'move-stop':
        return
    }
  })

  return { motions, skipped, readingIntervalsMs }
}
