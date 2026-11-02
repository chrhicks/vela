import { createReadStream, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { decodeManifest } from '@vela/rig-events'
import { separationDegrees } from '../../packages/rig-model/src/track.ts'
import { eventsOf, mayConcern, type MountEvent } from './am5-events.ts'

const root = process.argv[2]

if (!root) throw new Error('Usage: node tools/rig-model/am5-peak-speed.ts RECORDINGS')

const groups = new Map<string, { samples: number; peak: number; recording: string; seconds: number }>()

for (const name of readdirSync(root).sort()) {
  const mount = decodeManifest(JSON.parse(readFileSync(join(root, name, 'manifest.json'), 'utf8'))).devices.find(d => d.kind === 'mount')

  if (!mount) continue

  let previous: Extract<MountEvent, { type: 'position' }> | undefined
  let kind = 'uncommanded'
  let tracking = true
  let rate = 'unknown'
  let commands = 0

  for await (const line of createInterface({ input: createReadStream(join(root, name, 'traffic.jsonl')), crlfDelay: Infinity })) {
    if (!mayConcern(line, mount.indiDevice)) continue

    for (const event of eventsOf(line, mount.indiDevice)) {
      if (event.type === 'rate') rate = event.name

      if (event.type === 'tracking') tracking = event.on

      if (event.type === 'gap' || event.type === 'end') {
        previous = undefined
        kind = 'uncommanded'
      }

      if (event.type === 'command') {
        commands++
        kind = event.command.kind === 'move-start' ? `rate ${rate}` : event.command.kind
      }

      if (event.type !== 'position') continue

      if (previous && event.at > previous.at) {
        const seconds = (event.at - previous.at) / 1000
        const drift = tracking ? 0 : seconds * 360 / 86164.0905
        const speed = separationDegrees(previous, { raHours: event.raHours - drift / 15, decDegrees: event.decDegrees }) / seconds
        const group = groups.get(kind) ?? { samples: 0, peak: 0, recording: '', seconds: 0 }
        group.samples++

        if (speed > group.peak) Object.assign(group, { peak: speed, recording: name, seconds })

        groups.set(kind, group)
      }

      previous = event

      if ((kind === 'goto' || kind === 'home') && event.state !== 'Busy') kind = 'uncommanded'
    }
  }

  console.log(JSON.stringify({ recording: name, commands }))
}

console.log(JSON.stringify([...groups], null, 2))
