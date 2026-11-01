import type { MeasureName, Motion, Skipped } from './am5-motions.ts'

export interface RecordingResult {
  readonly name: string
  readonly motions: number
  readonly skipped: Skipped[]
  /** Why the whole recording was not read, if it was not. */
  readonly unread?: string
  readonly badLines: number
}

export interface Stat {
  readonly n: number
  readonly median: number
  readonly p90: number
  readonly max: number
}

export interface Profile {
  readonly recordings: RecordingResult[]
  readonly motions: (Motion & { recording: string })[]
  readonly readingIntervalsMs: number[]
}

/** Fewer samples than this cannot be trusted. */
export const tooFew = 5

const measures: { name: MeasureName; label: string; unit: string }[] = [
  { name: 'stopLatencyS', label: 'stop latency', unit: 's' },
  { name: 'overshootArcsec', label: 'overshoot', unit: 'arcsec' },
  { name: 'landingArcsec', label: 'landing offset', unit: 'arcsec' },
  { name: 'coastS', label: 'coast time', unit: 's' },
  { name: 'coastArcsec', label: 'coast distance', unit: 'arcsec' },
  { name: 'speedArcsecPerS', label: 'speed', unit: 'arcsec/s' },
]

function quantile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]!
}

export function statOf(values: readonly number[]): Stat | undefined {
  if (values.length === 0) return undefined

  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1

  return {
    n: sorted.length,
    median: sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
    p90: quantile(sorted, 0.9),
    max: sorted[sorted.length - 1]!,
  }
}

/** One entry per motion group, then per measure, in a stable order. */
export function groupsOf(motions: readonly Motion[]): Record<string, { count: number; measures: Partial<Record<MeasureName, Stat>> }> {
  return Object.fromEntries(
    [...groupBy(motions, motion => motion.group)]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, members]) => [
        group,
        {
          count: members.length,
          measures: Object.fromEntries(
            measures.flatMap(({ name }) => {
              const stat = statOf(members.flatMap(member => member.measures[name] ?? []))

              return stat === undefined ? [] : [[name, stat]]
            }),
          ),
        },
      ]),
  )
}

const fixed = (value: number) => (Math.abs(value) < 10 ? value.toFixed(2) : value.toFixed(1))

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()

  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item])

  return groups
}

const percentile = (values: readonly number[], fraction: number) => quantile([...values].sort((a, b) => a - b), fraction)

export function markdownOf(profile: Profile): string {
  const groups = groupsOf(profile.motions)
  const skipped = profile.recordings.flatMap(recording => recording.skipped.map(item => ({ ...item, recording: recording.name })))
  const reasons = groupBy(skipped, item => `${item.what}: ${item.reason}`)

  const rows = Object.entries(groups).flatMap(([group, { measures: found }]) =>
    measures.flatMap(({ name, label, unit }) => {
      const stat = found[name]

      return stat === undefined
        ? []
        : [`| ${group} | ${label} (${unit}) | ${stat.n} | ${fixed(stat.median)} | ${fixed(stat.p90)} | ${fixed(stat.max)} | ${stat.n < tooFew ? `**too few: ${stat.n} < ${tooFew}**` : ''} |`]
    }),
  )

  const unread = profile.recordings.filter(recording => recording.unread !== undefined)
  const intervals = profile.readingIntervalsMs

  return [
    '# AM5 motion profile from errai\'s INDI recordings',
    '',
    `${profile.recordings.length} recordings read, ${profile.motions.length} motions measured, ${skipped.length} skipped. A row with fewer than ${tooFew} samples is marked: do not trust it.`,
    '',
    '| Motion | Measure | n | median | p90 | max | Trust |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    '## How each measure is taken',
    '',
    `The AM5 publishes its position about once a second (consecutive readings while moving: median ${intervals.length === 0 ? 'n/a' : Math.round(percentile(intervals, 0.5))} ms, p90 ${intervals.length === 0 ? 'n/a' : Math.round(percentile(intervals, 0.9))} ms apart, ${intervals.length} pairs) and only when the position changes. Times are when Cria received a message, not when the driver read the mount. So:`,
    '',
    '- **Stop latency** is the time from the stop command (a rate move switched off, or an abort) to the last reading that shows movement. The mount was last seen moving then. It is an upper bound that is rounded up to the next reading, so a value near 1 s means "stopped within one reading".',
    '- **Overshoot** has two meanings. For a goto it is how far the reported position went past the commanded target on the final approach, on the worse axis, measured from the last reading more than 1 degree away. A goto that began within 1 degree has none. For a rate move or an abort it is how far the mount travelled along its direction after the command, from where it was at the command. That position is worked out from the last two readings, or from the start command and one reading when a rate move gave only one (all the 8x moves). That assumes the mount started within about 0.05 s, so an 8x overshoot is good to roughly its own size (plus or minus 40 arcsec); a reading less than 0.5 s after the start is not used. Speed times the timing error (tens of ms) bounds its accuracy: about 330 arcsec at 9x and 25 arcsec at 8x.',
    '- **Landing offset** is how far the reported position is from the commanded target in the reading where a goto stops saying Busy. The AM5 has no encoders: its position is a step count, so this measures the readout and not the sky. It is expected to be close to zero. The sky offset needs a plate solve (the goto-leg experiment).',
    '- **Distances** are axis angle: RA hours times 15 times 3600, Dec degrees times 3600, so they do not depend on where the mount points (9x reads 3 deg/s, 10,800 arcsec/s). A home move has a coast time and no distance, because home is at the pole where RA is undefined and the reported RA jumps.',
    '- **Coast** is how long and how far the position kept changing after the coordinate property said it was no longer moving. For a home move and for a stop that finds the property already Idle (tracking off), it starts at the first Idle report or the command. A goto ends in Ok and never in Idle, so its coast starts at the reading that stopped saying Busy. A rate move with tracking on stays Ok and never reports Idle, so it has no coast.',
    '- **Speed** is the speed over the last two readings before the stop, from moves with at least two readings. It checks the method against the rate name.',
    '- Sidereal drift is removed when tracking is off, so a mount at rest does not count as moving. A reading counts as movement above 1.5 display steps. The mount must be seen still for 1.5 polls before a stop counts as finished.',
    '',
    '## Skipped',
    '',
    skipped.length === 0 ? 'Nothing was skipped.' : '| Count | What and why | Recordings (seconds into each) |\n|---|---|---|',
    ...[...reasons]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([reason, items]) => `| ${items.length} | ${reason} | ${items.slice(0, 6).map(item => `${item.recording.slice(0, 19)} @${item.at}`).join('; ')}${items.length > 6 ? ', …' : ''} |`),
    '',
    '## Recordings',
    '',
    '| Recording | Motions measured | Skipped | Note |',
    '|---|---|---|---|',
    ...profile.recordings.map(recording => `| ${recording.name.slice(0, 19)} | ${recording.motions} | ${recording.skipped.length} | ${recording.unread ?? (recording.badLines > 0 ? `${recording.badLines} lines unreadable` : '')} |`),
    unread.length > 0 ? `\n${unread.length} recordings had no command to the mount (or no mount), so there was nothing in them to measure.` : '',
    '',
  ].join('\n')
}
