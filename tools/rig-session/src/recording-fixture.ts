import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Json } from './redact.ts'

/** Hand-made recording lines for tests: made-up devices and a made-up site, never a real night. */
export const recordingStart = Date.parse('2030-01-01T00:59:00Z')

export const fakeDevices = [
  { id: 'primary', kind: 'camera', indiDevice: 'Test Camera' },
  { id: 'mount', kind: 'mount', indiDevice: 'Test Mount' },
]

export interface FixtureOperation {
  readonly id: string
  readonly requestId?: string
  readonly deviceId?: string
  readonly kind?: string
  readonly acceptedAt: string
  readonly settledAt: string
  readonly outcome?: Readonly<Record<string, Json>>
  readonly parameters?: Json
}

const epoch = (iso: string) => Date.parse(iso)

export function opLine({ id, requestId, deviceId = 'primary', kind = 'capture', acceptedAt, settledAt, outcome, parameters }: FixtureOperation) {
  return {
    k: 'op',
    t: epoch(settledAt) - recordingStart,
    at: epoch(settledAt),
    operation: {
      id,
      requestId: requestId ?? `request-${id}`,
      instanceId: 'instance-1',
      deviceId,
      kind,
      parameters: parameters ?? { exposureSeconds: 50 },
      acceptedAt: epoch(acceptedAt),
      startedAt: epoch(acceptedAt),
      settledAt: epoch(settledAt),
      state: 'settled',
      outcome: outcome ?? { kind: 'confirmed', value: { values: {}, image: { id: `image-${id}`, original: { bytes: 5000 } } } },
    },
  }
}

/** The wire text of each line, one JSON document per line. */
export const jsonLines = (...lines: readonly object[]): string[] => lines.map(line => JSON.stringify(line))

export async function writeRecording(directory: string, lines: readonly string[], devices = fakeDevices): Promise<string> {
  await mkdir(join(directory, 'blobs'), { recursive: true })
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ format: 1, recording: 'test', instanceId: 'instance-1', startedAt: recordingStart, indi: { host: 'localhost', port: 7624 }, devices, limits: { queueBytes: 1, reserveBytes: 0 } }))
  await writeFile(join(directory, 'traffic.jsonl'), lines.map(line => `${line}\n`).join(''))

  return directory
}
