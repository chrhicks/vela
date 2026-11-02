import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { fitPolarAxis, type PolarFit, type RigidityVerdict, type Site } from '@vela/rig-sky'
import {
  diagnosticEntrySchema,
  diagnosticJournalName,
  maximumFitsBytes,
  maximumJournalBytes,
  type DiagnosticEntry,
  type DiagnosticFrameEntry,
} from './diagnostic-schema.js'
import {
  baselineFromAxis,
  createAlignmentBaseline,
  measureAlignment,
  type AlignmentBaseline,
  type AlignmentMeasurement,
  type AlignmentSample,
} from './geometry.js'
import { baselineRigidity, type RigidityFrame } from './baseline-rigidity.js'
import { physicalAlignmentSample } from './physical-coordinates.js'
import { sweepFix } from './sweep-fit.js'

export interface AlignmentDiagnosticReplayReport {
  validation: 'production-math-reproducibility-only'
  runId: string
  mode: 'offline' | 'physical'
  outcome: { phase: 'finished' | 'stopped' | 'failed' | 'incomplete'; error: string | null }
  truncatedFinalLine: boolean
  counts: {
    frames: number
    measurements: number
    physicalFrames: number
    verifiedOriginals: number
  }
  baseline: AlignmentBaseline | null
  /** The polar axis fitted again from the recorded sweep fixes; null for a three-point journal. */
  fit: PolarFit | null
  /** Sweep positions that gave no fix, with the reason the journal recorded. */
  dropped: { position: number; reason: string }[]
  /** Judged again from the recorded solves: the fit's verdict, or for a three-point physical journal the three-point one. Null for a three-point offline run, which has no mount reading. */
  rigidity: RigidityVerdict | null
  finalMeasurement: AlignmentMeasurement | null
  maximumDiscrepancies: {
    measurementArcsec: number
    correctionTargetDegrees: number
    physicalSampleDegrees: number
    physicalSampleTimeMs: number
    rigidityMissArcmin: number
    fitArcsec: number
  }
}

/** Re-executes recorded inputs through production mathematics. This neither runs
 * a solver nor independently validates the physical mount, sky, or measurement. */
export async function replayAlignmentDiagnostics(
  directory: string,
): Promise<AlignmentDiagnosticReplayReport> {
  const journal = (
    await readBoundedFile(join(directory, diagnosticJournalName), maximumJournalBytes)
  ).toString('utf8')

  const truncatedFinalLine = !journal.endsWith('\n')
  const lines = journal.split('\n')
  // A newline commits an entry. Even a parseable final object without it is incomplete.
  lines.pop()

  const entries = lines.map((line, index) => {
    try {
      return diagnosticEntrySchema.parse(JSON.parse(line))
    } catch (error) {
      throw new Error(`Invalid alignment diagnostic journal entry ${index + 1}`, { cause: error })
    }
  })

  const first = entries.shift()

  if (first?.type !== 'run') throw new Error('Alignment diagnostic journal is missing run metadata')

  const report: AlignmentDiagnosticReplayReport = {
    validation: 'production-math-reproducibility-only',
    runId: first.run.runId,
    mode: first.run.mode,
    outcome: { phase: 'incomplete', error: null },
    truncatedFinalLine,
    counts: { frames: 0, measurements: 0, physicalFrames: 0, verifiedOriginals: 0 },
    baseline: null,
    fit: null,
    dropped: [],
    rigidity: null,
    finalMeasurement: null,
    maximumDiscrepancies: {
      measurementArcsec: 0,
      correctionTargetDegrees: 0,
      physicalSampleDegrees: 0,
      physicalSampleTimeMs: 0,
      rigidityMissArcmin: 0,
      fitArcsec: 0,
    },
  }

  const baselineFrames: DiagnosticFrameEntry[] = []
  const originalNames = new Set<string>()
  let lastPosition = 0
  const closed = () => report.baseline ?? report.fit
  let latestFrame: DiagnosticFrameEntry | undefined
  let latestAdjustment: DiagnosticFrameEntry | undefined
  let outcome: Extract<DiagnosticEntry, { type: 'outcome' }> | undefined

  for (const entry of entries) {
    if (outcome) throw new Error('Alignment diagnostic journal contains entries after its outcome')

    switch (entry.type) {
      case 'run':
        throw new Error('Alignment diagnostic journal contains duplicate run metadata')
      case 'frame': {
        validateFrame(entry, first.run.mode)

        if (originalNames.has(entry.original.filename))
          throw new Error('Alignment diagnostic original filename was reused')
        originalNames.add(entry.original.filename)

        if (entry.evidence.phase === 'baseline') {
          if (closed() || entry.evidence.position <= lastPosition)
            throw new Error('Alignment diagnostic baseline frames are out of order')

          lastPosition = entry.evidence.position
          baselineFrames.push(entry)
        } else {
          if (!report.baseline)
            throw new Error('Alignment diagnostic adjustment is missing its baseline')
          latestAdjustment = entry
        }

        if (entry.evidence.physical) {
          const { site } = entry.evidence.physical

          const observingSite: Site = {
            latitudeDegrees: site.latitudeDegrees,
            longitudeDegrees: site.longitudeDegrees,
          }

          if (site.elevationMeters !== undefined)
            observingSite.elevationMeters = site.elevationMeters

          const recomputed = physicalAlignmentSample(
            entry.evidence.solution,
            { capturedAt: entry.capture.capturedAt, exposureSeconds: first.run.exposureSeconds },
            observingSite,
          )

          const recorded = entry.evidence.sample
          const discrepancies = report.maximumDiscrepancies
          discrepancies.physicalSampleDegrees = Math.max(
            discrepancies.physicalSampleDegrees,
            angleDifference(recomputed.raDegrees, recorded.raDegrees),
            Math.abs(recomputed.decDegrees - recorded.decDegrees),
            angleDifference(recomputed.siderealTimeDegrees, recorded.siderealTimeDegrees),
          )
          discrepancies.physicalSampleTimeMs = Math.max(
            discrepancies.physicalSampleTimeMs,
            Math.abs(Date.parse(recomputed.capturedAt) - Date.parse(recorded.capturedAt)),
          )
          report.counts.physicalFrames++
        }

        latestFrame = entry
        report.counts.frames++
        break
      }

      case 'dropped':
        if (closed() || entry.position <= lastPosition)
          throw new Error('Alignment diagnostic dropped fix is out of order')
        lastPosition = entry.position
        report.dropped.push({ position: entry.position, reason: entry.reason })
        break
      case 'fit': {
        if (
          closed() ||
          entry.fixes.length !== baselineFrames.length ||
          !entry.fixes.every(
            (fix, index) =>
              fix.position === baselineFrames[index]!.evidence.position &&
              sameSample(fix.sample, baselineFrames[index]!.evidence.sample),
          )
        ) {
          throw new Error('Alignment diagnostic fit does not match its solved frames')
        }

        const fixes = baselineFrames.map(frame => sweepFix(frame.evidence.position, frame.evidence))
        report.fit = fitPolarAxis(fixes, entry.latitudeDegrees)
        report.rigidity = report.fit.verdict
        compareFit(report, report.fit, entry)

        if (report.fit.verdict.status === 'rigid' && entry.polar)
          report.baseline = baselineFromAxis(entry.polar.axis, entry.fixes.at(-1)!.sample, entry.latitudeDegrees)

        break
      }

      case 'baseline': {
        if (
          closed() ||
          baselineFrames.length !== 3 ||
          !entry.samples.every((sample, index) =>
            sameSample(sample, baselineFrames[index]!.evidence.sample),
          )
        ) {
          throw new Error('Alignment diagnostic baseline does not match its three solved frames')
        }

        report.baseline = createAlignmentBaseline(entry.samples, entry.latitudeDegrees)
        compareMeasurement(report, report.baseline.measurement, entry.measurement)

        if (first.run.mode === 'physical') {
          report.rigidity = baselineRigidity(
            // SAFETY: three baseline frames were checked above, and a physical frame has its mount reading.
            baselineFrames.map(rigidityFrame) as [RigidityFrame, RigidityFrame, RigidityFrame],
          )

          if (entry.rigidity)
            report.maximumDiscrepancies.rigidityMissArcmin = Math.abs(
              report.rigidity.missArcmin - entry.rigidity.missArcmin,
            )
        }

        break
      }

      case 'measurement': {
        if (
          !report.baseline ||
          !latestFrame ||
          !sameSample(entry.sample, latestFrame.evidence.sample)
        ) {
          throw new Error(
            'Alignment diagnostic measurement is missing its baseline or solved frame',
          )
        }

        report.finalMeasurement = measureAlignment(report.baseline, entry.sample, entry.tracking)
        compareMeasurement(report, report.finalMeasurement, entry.measurement)
        report.counts.measurements++
        break
      }

      case 'outcome':
        if (entry.phase === 'finished' && !report.finalMeasurement)
          throw new Error('Finished alignment diagnostic has no measurement')
        outcome = entry
        break
    }
  }

  for (const frame of [...baselineFrames, ...(latestAdjustment ? [latestAdjustment] : [])]) {
    const original = await readBoundedFile(
      join(directory, frame.original.filename),
      maximumFitsBytes,
    )

    if (
      original.length !== frame.original.bytes ||
      createHash('sha256').update(original).digest('hex') !== frame.original.sha256
    ) {
      throw new Error(`Alignment diagnostic original integrity failure: ${frame.original.filename}`)
    }

    validateOriginalFits(original, frame)
    report.counts.verifiedOriginals++
  }

  if (outcome && !truncatedFinalLine)
    report.outcome = { phase: outcome.phase, error: outcome.error }

  return report
}

function compareFit(
  report: AlignmentDiagnosticReplayReport,
  fit: PolarFit,
  recorded: Extract<DiagnosticEntry, { type: 'fit' }>,
) {
  const { verdict } = recorded
  const poses = (steps: readonly { labelBefore: string; labelAfter: string }[]) => steps.map(step => `${step.labelBefore}>${step.labelAfter}`)

  if (
    fit.verdict.status !== verdict.status ||
    poses(fit.verdict.steps).join() !== poses(verdict.steps).join() ||
    Number.isFinite(fit.totalArcsec) !== (recorded.polar !== null)
  ) {
    throw new Error('Alignment diagnostic fit disagrees with the verdict recomputed from its frames')
  }

  const discrepancies = report.maximumDiscrepancies
  discrepancies.rigidityMissArcmin = Math.abs(fit.verdict.missArcmin - verdict.missArcmin)

  if (recorded.polar)
    discrepancies.fitArcsec = Math.max(
      Math.abs(fit.altitudeArcsec - recorded.polar.altitudeArcsec),
      Math.abs(fit.azimuthArcsec - recorded.polar.azimuthArcsec),
      Math.abs(fit.totalArcsec - recorded.polar.totalArcsec),
    )
}

function rigidityFrame(frame: DiagnosticFrameEntry): RigidityFrame {
  return {
    solved: frame.evidence.solution.wcs,
    sample: frame.evidence.sample,
    mountRightAscensionDegrees: frame.evidence.physical!.before.rightAscensionDegrees,
  }
}

function validateFrame(frame: DiagnosticFrameEntry, mode: 'physical' | 'offline') {
  const { evidence, capture } = frame
  const { wcs } = evidence.solution

  if (
    wcs.width !== capture.width ||
    wcs.height !== capture.height ||
    evidence.solution.capturedAt !== capture.capturedAt ||
    !frame.original.filename.startsWith(`${evidence.phase}-`) ||
    ![2, 4].some(bytesPerSample => fitsBytes(capture, bytesPerSample) === frame.original.bytes)
  ) {
    throw new Error('Alignment diagnostic frame dimensions, timing or original metadata disagree')
  }

  if (mode === 'physical' && (!evidence.physical || evidence.offlinePointing)) {
    throw new Error('Physical alignment diagnostic frame is missing physical inputs or mixes modes')
  }

  if (mode === 'offline' && (evidence.physical || !evidence.offlinePointing)) {
    throw new Error('Offline alignment diagnostic frame is missing pointing or mixes modes')
  }
}

function fitsBytes(capture: DiagnosticFrameEntry['capture'], bytesPerSample: number) {
  return 2880 + Math.ceil((capture.width * capture.height * bytesPerSample) / 2880) * 2880
}

/** Check only Vela's two emitted primary-image layouts, not arbitrary FITS input.
 * Older adjustment files may have rotated out; retained files must agree with
 * their journal dimensions and exact encoding, as well as their size and hash. */
function validateOriginalFits(original: Buffer, frame: DiagnosticFrameEntry) {
  const cards = Array.from({ length: 36 }, (_, index) =>
    original.toString('latin1', index * 80, (index + 1) * 80),
  )

  const numberCard = (key: string, value: number) =>
    `${key.padEnd(8)}= ${String(value).padStart(20)}`.padEnd(80)

  const unsigned16 = cards[1] === numberCard('BITPIX', 16)
  const bytesPerSample = unsigned16 ? 2 : 4

  const required = [
    'SIMPLE  =                    T'.padEnd(80),
    numberCard('BITPIX', unsigned16 ? 16 : 32),
    numberCard('NAXIS', 2),
    numberCard('NAXIS1', frame.capture.width),
    numberCard('NAXIS2', frame.capture.height),
  ]

  const end = cards.indexOf('END'.padEnd(80))

  if (
    required.some(
      (card, index) =>
        cards[index] !== card ||
        cards.filter(other => other.slice(0, 8) === card.slice(0, 8)).length !== 1,
    ) ||
    end < required.length ||
    cards.slice(end + 1).some(card => card !== ' '.repeat(80)) ||
    fitsBytes(frame.capture, bytesPerSample) !== original.length
  ) {
    throw new Error('Alignment diagnostic FITS layout or dimensions disagree with its journal')
  }

  for (const [key, value] of [
    ['BZERO', 32_768],
    ['BSCALE', 1],
  ] as const) {
    const scaling = cards.filter(card => card.slice(0, 8).trim() === key)

    if (
      unsigned16
        ? scaling.length !== 1 || scaling[0] !== numberCard(key, value)
        : scaling.length !== 0
    ) {
      throw new Error('Alignment diagnostic FITS has unsupported sample scaling')
    }
  }
}

function sameSample(a: AlignmentSample, b: AlignmentSample) {
  return (
    a.raDegrees === b.raDegrees &&
    a.decDegrees === b.decDegrees &&
    a.siderealTimeDegrees === b.siderealTimeDegrees &&
    a.capturedAt === b.capturedAt
  )
}

function angleDifference(a: number, b: number) {
  return Math.abs(((a - b + 540) % 360) - 180)
}

function compareMeasurement(
  report: AlignmentDiagnosticReplayReport,
  actual: AlignmentMeasurement,
  recorded: AlignmentMeasurement,
) {
  const discrepancies = report.maximumDiscrepancies
  discrepancies.measurementArcsec = Math.max(
    discrepancies.measurementArcsec,
    Math.abs(actual.altitudeArcsec - recorded.altitudeArcsec),
    Math.abs(actual.azimuthArcsec - recorded.azimuthArcsec),
    Math.abs(actual.totalArcsec - recorded.totalArcsec),
  )
  discrepancies.correctionTargetDegrees = Math.max(
    discrepancies.correctionTargetDegrees,
    angleDifference(actual.correctionTarget.raDegrees, recorded.correctionTarget.raDegrees),
    Math.abs(actual.correctionTarget.decDegrees - recorded.correctionTarget.decDegrees),
  )
}

async function readBoundedFile(path: string, maximumBytes: number): Promise<Buffer> {
  // Do not follow journal-supplied symlinks, block on FIFOs, or let readFile allocate
  // from an unbounded external file. The extra byte detects growth after stat.
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)

  try {
    const stat = await file.stat()

    if (!stat.isFile() || stat.size > maximumBytes)
      throw new Error(`Alignment diagnostic file is not regular or exceeds its size cap: ${path}`)
    const bytes = Buffer.alloc(stat.size + 1)
    let length = 0

    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, null)

      if (read.bytesRead === 0) break
      length += read.bytesRead
    }

    if (length !== stat.size)
      throw new Error(`Alignment diagnostic file changed while reading: ${path}`)

    return bytes.subarray(0, length)
  } finally {
    await file.close()
  }
}
