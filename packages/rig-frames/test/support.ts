import { createHash } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { epochMs } from '@vela/rig-events'
import { imageIdOf, syntheticSite } from '@vela/rig-testing'
import type { FrameRecord, SavedImage } from '@vela/rig-frames'

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

export const rigName = 'test-rig'

export const dataDirectory = () => mkdtemp(join(tmpdir(), 'rig-frames-test-'))

export interface ImageSpec {
  readonly index: number
  readonly capturedAt: string
  readonly frameType?: string
  readonly exposureSeconds?: number
}

/** Writes one saved image the way Vela's store lays it out, with the fields the store adds that this package ignores. */
export async function writeImage(dataDir: string, spec: ImageSpec, directoryName?: string): Promise<string> {
  const id = imageIdOf(spec.index)
  const directory = join(dataDir, 'saved-images', sha256(rigName), directoryName ?? sha256(id))

  await mkdir(directory, { recursive: true })

  await writeFile(
    join(directory, 'metadata.json'),
    JSON.stringify({
      id,
      rigId: rigName,
      saved: true,
      frameType: spec.frameType,
      savedAt: '2026-10-26T21:00:00.000Z',
      capturedAt: spec.capturedAt,
      receivedAt: new Date(Date.parse(spec.capturedAt) + 1500).toISOString(),
      capturedAtSource: 'camera',
      width: 64,
      height: 48,
      exposureSeconds: spec.exposureSeconds ?? 10,
      cameraName: 'Test Camera',
      subject: null,
      statistics: { detectedStars: 3, medianHfrPixels: 2.1 },
      imageUrl: `/api/rigs/${rigName}/saved-images/${id}/preview`,
    }),
  )

  await writeFile(join(directory, 'original.fits'), Buffer.alloc(2880))

  return directory
}

export function recordLine(spec: ImageSpec | { readonly attempt: number; readonly outcome: string; readonly startedAt: string }, outcome = 'saved'): string {
  if ('index' in spec) {
    const captured = Date.parse(spec.capturedAt)

    return JSON.stringify({
      version: 1,
      rigId: rigName,
      runId: 'run-1',
      attempt: spec.index,
      startedAt: new Date(captured - 5).toISOString(),
      settledAt: new Date(captured + 2000).toISOString(),
      exposureSeconds: spec.exposureSeconds ?? 10,
      frameType: spec.frameType,
      subject: null,
      outcome,
      message: null,
      provenance: { requestId: 'r', operationId: 'o', imageId: 'cria-side-id' },
      image: { id: imageIdOf(spec.index), capturedAt: spec.capturedAt, capturedAtSource: 'camera', receivedAt: new Date(captured + 1500).toISOString(), width: 64, height: 48 },
      statistics: { detectedStars: 3, medianHfrPixels: 2.1 },
    })
  }

  return JSON.stringify({
    version: 1,
    rigId: rigName,
    runId: 'run-1',
    attempt: spec.attempt,
    startedAt: spec.startedAt,
    settledAt: new Date(Date.parse(spec.startedAt) + 3000).toISOString(),
    exposureSeconds: 10,
    subject: null,
    outcome: spec.outcome,
    message: 'stopped by the operator',
    provenance: null,
    image: null,
    statistics: null,
  })
}

export async function writeRecords(dataDir: string, lines: readonly string[], tail = '\n'): Promise<string> {
  const path = join(dataDir, 'traces/frames.jsonl')

  await mkdir(join(dataDir, 'traces'), { recursive: true })
  await writeFile(path, lines.map(line => `${line}\n`).join(''))

  if (tail !== '\n') await appendFile(path, tail)

  return path
}

export const trialRunId = '2bfbf00c-acf2-4bf2-9ee3-09a08615b7b8'

const sample = { raDegrees: 91.5, decDegrees: 10.25, capturedAt: '2026-10-26T23:38:36.936Z', siderealTimeDegrees: 211.75 }

const mountReading = { rightAscensionDegrees: 91.5, declinationDegrees: 10.25, coordinateSystem: 'topocentric', tracking: true, slewing: false, parked: false, observedAt: '2026-10-26T23:38:36.000Z', latitudeDegrees: syntheticSite.latitudeDegrees, longitudeDegrees: syntheticSite.longitudeDegrees, elevationMeters: syntheticSite.elevationMeters }

function frameLine(phase: 'baseline' | 'adjusting', position: number, filename: string): string {
  return JSON.stringify({
    type: 'frame',
    original: { filename, bytes: 2880, sha256: sha256(filename) },
    capture: { width: 64, height: 48, capturedAt: sample.capturedAt, capturedAtSource: 'camera', color: { kind: 'mono' } },
    evidence: {
      phase,
      position,
      solution: { status: 'solved', capturedAt: sample.capturedAt, raDegrees: 91.5, decDegrees: 10.25, wcs: { width: 64, height: 48, referenceX: 32.5, referenceY: 24.5, raDegrees: 91.5, decDegrees: 10.25, cd: [-5.2e-6, 0.000535, -0.000535, -5.6e-6] } },
      sample,
      hint: { raDegrees: 91.4, decDegrees: 10.2 },
      fieldHeightDegrees: 2.5,
      physical: { site: syntheticSite, camera: { cameraName: 'Test Camera' }, before: mountReading, after: mountReading },
    },
  })
}

export interface TrialSpec {
  readonly runId?: string
  readonly createdAt: string
  readonly outcome?: 'finished' | 'stopped' | 'failed'
  readonly adjusting?: number
  readonly suffix?: string
  readonly extraLines?: readonly string[]
}

/** Writes a trial folder with the site in the places Vela puts it, so a test can check that none of it comes back out. */
export async function writeTrial(dataDir: string, spec: TrialSpec): Promise<string> {
  const runId = spec.runId ?? trialRunId
  const directory = join(dataDir, 'alignment-diagnostics/trials', `${runId}-${spec.suffix ?? 'aBcDeF'}`)
  const baselines = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']
  const adjusting = Array.from({ length: spec.adjusting ?? 2 }, (_, index) => `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`)

  await mkdir(directory, { recursive: true })

  const lines = [
    JSON.stringify({ type: 'run', schemaVersion: 1, createdAt: spec.createdAt, run: { runId, rigId: rigName, rigName: 'Test Rig', mode: 'physical', cameraId: 'c', telescopeId: 't', cameraName: 'Test Camera', exposureSeconds: 2 } }),
    ...baselines.map((id, index) => frameLine('baseline', index + 1, `baseline-${id}.fits`)),
    JSON.stringify({ type: 'baseline', samples: [sample, sample, sample], latitudeDegrees: syntheticSite.latitudeDegrees, measurement: { altitudeArcsec: 1, azimuthArcsec: 2, totalArcsec: 2.2, correctionTarget: { raDegrees: 1, decDegrees: 2 } } }),
    ...adjusting.flatMap(id => [
      frameLine('adjusting', 1, `adjusting-${id}.fits`),
      JSON.stringify({ type: 'measurement', sample, measurement: { altitudeArcsec: 1, azimuthArcsec: 2, totalArcsec: 2.2, correctionTarget: { raDegrees: 1, decDegrees: 2 } }, tracking: true, mount: mountReading }),
    ]),
    ...(spec.extraLines ?? []),
    ...(spec.outcome ? [JSON.stringify({ type: 'outcome', phase: spec.outcome, error: null })] : []),
  ]

  await writeFile(join(directory, 'journal.jsonl'), lines.map(line => `${line}\n`).join(''))

  for (const name of [...baselines.map(id => `baseline-${id}.fits`), `adjusting-${adjusting.at(-1)}.fits`]) await writeFile(join(directory, name), Buffer.alloc(2880))

  return directory
}

export const savedImage = (overrides: Partial<SavedImage> & { readonly index: number }): SavedImage => ({
  id: imageIdOf(overrides.index),
  rigId: rigName,
  frameType: 'light',
  capturedAt: epochMs(Date.parse('2026-10-26T20:00:00.000Z')),
  capturedAtSource: 'camera',
  receivedAt: epochMs(Date.parse('2026-10-26T20:00:01.500Z')),
  savedAt: epochMs(Date.parse('2026-10-26T20:00:02.000Z')),
  exposureSeconds: 10,
  width: 64,
  height: 48,
  filter: null,
  fitsPath: '/data/saved-images/x/y/original.fits',
  fitsBytes: 2880,
  ...overrides,
})

export const frameRecord = (overrides: Partial<FrameRecord> & { readonly attempt: number }): FrameRecord => ({
  line: overrides.attempt,
  rigId: rigName,
  runId: 'run-1',
  startedAt: epochMs(Date.parse('2026-10-26T19:59:59.995Z')),
  settledAt: epochMs(Date.parse('2026-10-26T20:00:02.000Z')),
  exposureSeconds: 10,
  frameType: 'light',
  subject: null,
  outcome: 'saved',
  image: { id: imageIdOf(overrides.attempt), capturedAt: epochMs(Date.parse('2026-10-26T20:00:00.000Z')), capturedAtSource: 'camera', receivedAt: epochMs(Date.parse('2026-10-26T20:00:01.500Z')), width: 64, height: 48 },
  statistics: null,
  ...overrides,
})
