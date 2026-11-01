import { describe, expect, it } from 'vitest'
import { eventsOf } from './am5-events.ts'
import { analyse } from './am5-motions.ts'
import { markdownOf, statOf } from './am5-report.ts'

const device = 'Synthetic mount'

const start = 1_792_000_000_000

const siderealHoursPerSecond = 1.0027379093 / 3600

const arcsecPerHour = 54_000

let sequence: string[] = []

const message = (seconds: number, dir: 'in' | 'out', xml: string) => sequence.push(JSON.stringify({ k: 'msg', at: start + Math.round(seconds * 1000), dir, xml }))

const numbers = (verb: string, name: string, state: string, values: Record<string, number>, extra = '') =>
  `<${verb}NumberVector device="${device}" name="${name}" state="${state}"${verb === 'def' ? ' perm="rw"' : ''}>${Object.entries(values)
    .map(([key, value]) => `<${verb === 'def' ? 'defNumber' : 'oneNumber'} name="${key}"${verb === 'def' ? ` label="${key}" format="%010.6m"` : ''}>${value}${extra}</${verb === 'def' ? 'defNumber' : 'oneNumber'}>`)
    .join('')}</${verb}NumberVector>`

const switches = (verb: string, name: string, values: Record<string, boolean>, state = 'Ok') =>
  `<${verb}SwitchVector device="${device}" name="${name}" state="${state}"${verb === 'def' ? ' perm="rw"' : ''}>${Object.entries(values)
    .map(([key, on]) => `<${verb === 'def' ? 'defSwitch' : 'oneSwitch'} name="${key}">${on ? 'On' : 'Off'}</${verb === 'def' ? 'defSwitch' : 'oneSwitch'}>`)
    .join('')}</${verb}SwitchVector>`

const reading = (seconds: number, state: string, ra: number, dec = 40) => message(seconds, 'in', numbers('set', 'EQUATORIAL_EOD_COORD', state, { RA: ra, DEC: dec }))

const moveOn = (seconds: number) => message(seconds, 'out', switches('new', 'TELESCOPE_MOTION_WE', { MOTION_WEST: true }))

const moveOff = (seconds: number) => message(seconds, 'out', switches('new', 'TELESCOPE_MOTION_WE', { MOTION_EAST: false, MOTION_WEST: false }))

function analysed() {
  const events = sequence.map(line => eventsOf(line, device)).flat()

  sequence = []

  return analyse(events, start)
}

describe('AM5 profile', () => {
  it('measures a rate move stopped at a known time: latency, stop distance and speed', () => {
    message(0, 'in', numbers('def', 'EQUATORIAL_EOD_COORD', 'Ok', { RA: 3, DEC: 40 }))
    message(0, 'in', switches('def', 'TELESCOPE_TRACK_STATE', { TRACK_ON: true, TRACK_OFF: false }))
    message(0, 'in', switches('def', 'TELESCOPE_SLEW_RATE', { '8x': false, '9x': true }))
    moveOn(10)
    reading(10.4, 'Ok', 3.08)
    reading(11.4, 'Ok', 3.28)
    reading(12.4, 'Ok', 3.48)
    moveOff(13.2)
    reading(13.4, 'Ok', 3.66)
    sequence.push(JSON.stringify({ k: 'end', at: start + 20_000 }))

    const { motions, skipped } = analysed()

    expect(skipped).toEqual([])
    expect(motions).toHaveLength(1)
    expect(motions[0]!.group).toBe('rate-move 9x')
    expect(motions[0]!.measures.stopLatencyS).toBeCloseTo(0.2, 3)
    expect(motions[0]!.measures.overshootArcsec).toBeCloseTo(0.02 * arcsecPerHour, 0)
    expect(motions[0]!.measures.speedArcsecPerS).toBeCloseTo(0.2 * arcsecPerHour, 0)
    expect(motions[0]!.measures.coastS).toBeUndefined()
  })

  it('measures coast after Idle on a mount that is not tracking, ignoring its sidereal drift', () => {
    const drifted = (seconds: number, travelled: number) => 3 + travelled + siderealHoursPerSecond * seconds

    message(0, 'in', numbers('def', 'EQUATORIAL_EOD_COORD', 'Idle', { RA: 3, DEC: 40 }))
    message(0, 'in', switches('def', 'TELESCOPE_TRACK_STATE', { TRACK_ON: false, TRACK_OFF: true }))
    message(0, 'in', switches('def', 'TELESCOPE_SLEW_RATE', { '9x': true }))
    moveOn(10)
    reading(10.4, 'Idle', drifted(10.4, 0.08))
    reading(11.4, 'Idle', drifted(11.4, 0.28))
    reading(12.4, 'Idle', drifted(12.4, 0.48))
    moveOff(13.2)
    reading(13.4, 'Idle', drifted(13.4, 0.64 + 0.02))
    reading(14.4, 'Idle', drifted(14.4, 0.66))
    reading(17.4, 'Idle', drifted(17.4, 0.66))
    sequence.push(JSON.stringify({ k: 'end', at: start + 20_000 }))

    const { motions } = analysed()

    expect(motions).toHaveLength(1)
    expect(motions[0]!.measures.stopLatencyS).toBeCloseTo(0.2, 3)
    expect(motions[0]!.measures.overshootArcsec).toBeCloseTo(0.02 * arcsecPerHour, -1)
    expect(motions[0]!.measures.coastS).toBeCloseTo(0.2, 3)
    expect(motions[0]!.measures.coastArcsec).toBeCloseTo(0.02 * arcsecPerHour, -1)
  })

  it('measures a goto: overshoot past the target, landing offset, and no coast after Ok', () => {
    message(0, 'in', numbers('def', 'EQUATORIAL_EOD_COORD', 'Ok', { RA: 3, DEC: 40 }))
    message(0, 'in', switches('def', 'TELESCOPE_TRACK_STATE', { TRACK_ON: true, TRACK_OFF: false }))
    message(30, 'out', numbers('new', 'EQUATORIAL_EOD_COORD', 'Ok', { RA: 5, DEC: 45 }))
    reading(31, 'Busy', 4.8, 44)
    reading(32, 'Busy', 5.003, 45)
    reading(33, 'Ok', 5 + 0.0001, 45)
    sequence.push(JSON.stringify({ k: 'end', at: start + 40_000 }))

    const { motions } = analysed()

    expect(motions).toHaveLength(1)
    expect(motions[0]!.group).toBe('goto')
    expect(motions[0]!.measures.overshootArcsec).toBeCloseTo(0.003 * arcsecPerHour, 0)
    expect(motions[0]!.measures.landingArcsec).toBeCloseTo(0.0001 * arcsecPerHour, 0)
    expect(motions[0]!.measures.coastS).toBe(0)
  })

  it('skips an abort with nothing moving, and says why', () => {
    message(0, 'in', numbers('def', 'EQUATORIAL_EOD_COORD', 'Ok', { RA: 3, DEC: 40 }))
    message(5, 'out', switches('new', 'TELESCOPE_ABORT_MOTION', { ABORT: true }))
    sequence.push(JSON.stringify({ k: 'end', at: start + 20_000 }))

    const { motions, skipped } = analysed()

    expect(motions).toEqual([])
    expect(skipped).toEqual([{ at: 5, what: 'abort', reason: 'nothing was moving' }])
  })

  it('counts a request relayed from another client as a command', () => {
    message(0, 'in', numbers('def', 'EQUATORIAL_EOD_COORD', 'Ok', { RA: 3, DEC: 40 }))
    message(5, 'in', switches('new', 'TELESCOPE_ABORT_MOTION', { ABORT: true }))

    expect(sequence.flatMap(line => eventsOf(line, device)).map(event => event.type)).toEqual(['steps', 'position', 'command'])

    sequence = []
  })

  it('reports the median, p90 and max, and marks a row with fewer than five samples', () => {
    expect(statOf([4, 1, 3, 2, 10, 5, 6, 7, 8, 9])).toEqual({ n: 10, median: 5.5, p90: 9, max: 10 })

    const report = markdownOf({
      recordings: [{ name: 'night', motions: 2, skipped: [], badLines: 0 }],
      motions: [
        { recording: 'night', group: 'goto', at: 1, measures: { landingArcsec: 2 } },
        { recording: 'night', group: 'goto', at: 2, measures: { landingArcsec: 4 } },
      ],
      readingIntervalsMs: [],
    })

    expect(report).toContain('| goto | landing offset (arcsec) | 2 | 3.00 | 4.00 | 4.00 | **too few: 2 < 5** |')
  })
})
