import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { z } from 'zod'
import { judgeAim, type AimEvent } from './judge.js'

const spanSchema = z.object({
  name: z.string(), traceId: z.string(), startTimeUnixNano: z.string(),
  endTimeUnixNano: z.string().optional(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
})

// Old traces predate both assess and step 6 verdicts. This replays arrival truth only,
// conditional on admission and on the recorded solves being accepted. It cannot prove admission.
export async function replayAim(path: string, date: string) {
  const goals = new Map<string, z.infer<typeof spanSchema>[]>()
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })

  for await (const line of lines) {
    const parsed = spanSchema.safeParse(JSON.parse(line))

    if (!parsed.success || !parsed.data.name.startsWith('framing.')) continue
    const span = parsed.data
    const spans = goals.get(span.traceId) ?? []
    spans.push(span)
    goals.set(span.traceId, spans)
  }

  const rows = []

  for (const spans of goals.values()) {
    spans.sort((a, b) => Number(a.startTimeUnixNano) - Number(b.startTimeUnixNano))
    const run = spans.find(span => span.name === 'framing.run')

    if (!run || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Number(run.startTimeUnixNano) / 1e6)) !== date) continue
    const attrs = run.attributes
    const events: AimEvent[] = []

    for (const span of spans) {
      const a = span.attributes

      if (span.name === 'framing.move.requested')
        events.push({ kind: 'move', correction: z.number().parse(a['framing.correction']) })

      if (span.name === 'framing.solved')
        events.push({ kind: 'solve', verdict: 'accepted', residualArcmin: z.number().parse(a['framing.solved.offset_arcminutes']) })
    }

    const result = judgeAim({
      goalId: String(rows.length + 1),
      target: {
        raDegrees: z.number().parse(attrs['framing.desired.ra_degrees']),
        decDegrees: z.number().parse(attrs['framing.desired.dec_degrees']),
      },
      assessment: { confidence: 'low', budgetArcmin: 3, blindTravelDegrees: 0 },
      refusal: null, events,
      elapsedMs: (Number(run.endTimeUnixNano) - Number(run.startTimeUnixNano)) / 1e6,
      completed: attrs['framing.phase'] === 'checked',
    })

    rows.push({ goal: result.goalId, action: attrs['framing.action'], status: result.status,
      reason: result.reason, residualArcmin: result.residualArcmin, elapsedMs: Math.round(result.elapsedMs),
      corrections: result.corrections, gotoMissArcmin: result.gotoMissArcmin, gotoWarning: result.gotoWarning })
  }

  return rows
}

if (process.argv[1]?.endsWith('/aim/replay.ts')) {
  const path = z.string().parse(process.argv[2])
  const dates = process.argv[3] ? [process.argv[3]] : ['2026-10-17', '2026-10-26']

  console.log('Arrival-only replay. Starting assessment and solve verdicts were not recorded; admission and accepted solves are assumed. Local dates use America/New_York.')

  for (const date of dates) {
    const rows = await replayAim(path, date)
    const firstSlews = rows.filter(row => row.action === 'start' && row.gotoMissArcmin !== null && row.gotoMissArcmin > 0.5)

    console.log(date)

    for (const row of rows) console.log(JSON.stringify(row))

    if (!firstSlews.length || firstSlews.some(row => row.status !== 'missed'))
      throw new Error('Replay did not flag every first-slew miss')

    if (date === '2026-10-17' && !firstSlews.some(row => Math.abs((row.gotoMissArcmin ?? 0) - 73.2) < 0.1))
      throw new Error('Replay did not include the 73.2 arcmin miss')
  }
}
