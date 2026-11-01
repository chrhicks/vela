import { createReadStream, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { decodeManifest, decodeRecordingLine } from '@vela/rig-events'
import { eventsOf, mayConcern, type MountEvent } from './am5-events.ts'
import { analyse } from './am5-motions.ts'
import { groupsOf, markdownOf, type Profile, type RecordingResult } from './am5-report.ts'

const option = (name: string) => {
  const index = process.argv.indexOf(`--${name}`)

  return index >= 0 ? process.argv[index + 1] : undefined
}

const recordings = option('recordings')

if (recordings === undefined) throw new Error('--recordings DIR is required: the folder that holds one folder per Cria run. Optional: --report FILE.md, --json FILE.json')

const profile: Profile = { recordings: [], motions: [], readingIntervalsMs: [] }

for (const name of readdirSync(recordings).sort()) {
  const mount = decodeManifest(JSON.parse(readFileSync(join(recordings, name, 'manifest.json'), 'utf8'))).devices.find(device => device.kind === 'mount')

  if (mount === undefined) {
    profile.recordings.push({ name, motions: 0, skipped: [], unread: 'the manifest names no mount', badLines: 0 })
    continue
  }

  const events: MountEvent[] = []
  let badLines = 0
  let startedAt: number | undefined

  const lines = createInterface({ input: createReadStream(join(recordings, name, 'traffic.jsonl')), crlfDelay: Infinity })

  for await (const line of lines) {
    startedAt ??= decodeRecordingLine(JSON.parse(line)).at

    if (!mayConcern(line, mount.indiDevice)) continue

    try {
      events.push(...eventsOf(line, mount.indiDevice))
    } catch {
      badLines++
    }
  }

  if (!events.some(event => event.type === 'command')) {
    profile.recordings.push({ name, motions: 0, skipped: [], unread: 'no command to the mount', badLines })
    continue
  }

  const analysis = analyse(events, startedAt ?? 0)

  profile.motions.push(...analysis.motions.map(motion => ({ ...motion, recording: name })))
  profile.readingIntervalsMs.push(...analysis.readingIntervalsMs)
  profile.recordings.push({ name, motions: analysis.motions.length, skipped: analysis.skipped, badLines } satisfies RecordingResult)
}

const markdown = markdownOf(profile)

const reportPath = option('report')

const jsonPath = option('json')

if (reportPath === undefined) console.log(markdown)
else writeFileSync(reportPath, markdown)

if (jsonPath !== undefined) writeFileSync(jsonPath, `${JSON.stringify({ ...profile, groups: groupsOf(profile.motions) }, null, 2)}\n`)
