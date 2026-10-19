import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { acceptSession, formatAcceptance, type AcceptRequest } from './accept.ts'
import { PrivacyCheckError } from './package.ts'
import { jsonLines, msgLine, opLine, writeRecording } from './recording-fixture.ts'
import { buildSession } from './session.ts'

const window = { from: new Date('2030-01-01T00:00:00Z'), to: new Date('2030-01-01T06:00:00Z') }

/** One frame from made-up files, with a made-up site (latitude 12.5, longitude 345.25) in the recording. */
async function night(): Promise<AcceptRequest> {
  const dir = await mkdtemp(join(tmpdir(), 'rig-session-accept-test-'))
  const frameDir = join(dir, 'saved-images', 'library', 'frame-0')
  const frameRecordsFile = join(dir, 'frames.jsonl')

  await mkdir(frameDir, { recursive: true })
  await writeFile(join(frameDir, 'metadata.json'), JSON.stringify({ id: 'frame-0', width: 100, height: 80, exposureSeconds: 50, capturedAt: '2030-01-01T01:01:00.000Z', receivedAt: '2030-01-01T01:01:55.000Z', cameraName: 'Test camera', capturedAtSource: 'camera', rigId: 'rig-a' }))
  await writeFile(frameRecordsFile, `${JSON.stringify({ version: 1, rigId: 'rig-a', runId: 'run-1', attempt: 1, startedAt: '2030-01-01T01:01:00.000Z', settledAt: '2030-01-01T01:01:56.000Z', exposureSeconds: 50, subject: null, outcome: 'saved', message: 'on /dev/ttyUSB0 at LAT=12.5', provenance: { requestId: 'request-0', operationId: 'operation-0', imageId: 'cria-image-0' }, image: { id: 'frame-0', capturedAt: '2030-01-01T01:01:00.000Z', capturedAtSource: 'camera', receivedAt: '2030-01-01T01:01:55.000Z', width: 100, height: 80 }, statistics: null })}\n`)

  const recordingDir = await writeRecording(join(dir, 'recording'), jsonLines(
    opLine({ id: 'operation-0', requestId: 'request-0', acceptedAt: '2030-01-01T01:01:00Z', settledAt: '2030-01-01T01:01:55Z' }),
    msgLine(0, '2030-01-01T00:59:10Z', 'out', '<newNumberVector device="Test Mount" name="GEOGRAPHIC_COORD"><oneNumber name="LAT">12.5</oneNumber><oneNumber name="LONG">345.25</oneNumber></newNumberVector>'),
    { k: 'end', t: 1, at: Date.parse('2030-01-01T01:10:00Z') },
  ))

  return { window, scratch: dir, savedImagesDir: join(dir, 'saved-images'), tracesFile: null, mountCsvFile: null, frameRecordsFile, recordingDir, journalFile: null }
}

test('a synthetic night passes: identical builds, a clean scan, unchanged inputs, and the missing inputs listed', async () => {
  const request = await night()
  const result = await acceptSession(request)
  const text = formatAcceptance(result)

  expect(result.problems).toEqual([])
  expect(result.summary?.rows).toMatchObject({ frames: 1, attempts: 1, indi_ops: 1 })
  expect(result.summary?.links.frame_to_operation).toEqual({ exact: 1, inferred: 0, ambiguous: 0, none: 0 })
  expect(text).toContain('missing traces:')
  expect(text).toContain('missing cria-journal:')
  expect(text).toContain('frames               1')
  expect(text).toContain('PASS')
  expect(await readdir(request.scratch)).not.toContainEqual(expect.stringContaining('rig-session-accept-'))
})

test('the report holds counts and names only: no site, port or message text', async () => {
  const text = formatAcceptance(await acceptSession(await night()))

  for (const value of ['12.5', '345.25', '/dev/', 'ttyUSB0', 'LAT=', 'Test Mount', 'Test camera', 'frame-0', 'request-0']) expect(text).not.toContain(value)
})

test('a leak found in the package fails the run and names the table and column, never the value', async () => {
  const leaking: typeof buildSession = async () => {
    throw new PrivacyCheckError(['attempts.message: learned coordinate'])
  }

  const result = await acceptSession(await night(), leaking)
  const text = formatAcceptance(result)

  expect(result.problems).toEqual(['privacy scan: attempts.message: learned coordinate (the build failed closed, nothing was published)'])
  expect(text).toContain('FAIL: privacy scan: attempts.message: learned coordinate')
  expect(text).not.toContain('PASS')
})

test('builds that differ fail the run and name the file', async () => {
  let builds = 0

  const unstable: typeof buildSession = async request => {
    const directory = await buildSession(request)

    if (builds++ === 1) await writeFile(join(directory, 'frames.parquet'), 'different')

    return directory
  }

  const result = await acceptSession(await night(), unstable)

  expect(result.problems).toEqual(['the second build differs in frames.parquet'])
})

test('an input changed by the run fails it; one another process appended to fails too unless growth is allowed', async () => {
  const request = await night()
  const records = request.frameRecordsFile ?? ''
  const original = await readFile(records, 'utf8')

  const touching = (change: string): typeof buildSession => async built => {
    await writeFile(records, change)

    return buildSession(built)
  }

  expect((await acceptSession(request, touching(original.replace('request-0', 'request-1')))).problems).toEqual(['frame-records changed while the command ran'])

  await writeFile(records, original)

  expect((await acceptSession(request, touching(`${original}\n`))).problems).toEqual([expect.stringContaining('frame-records grew while the command ran')])

  await writeFile(records, original)

  const allowed = await acceptSession({ ...request, allowGrowth: true }, touching(`${original}\n`))

  expect(allowed.problems).toEqual([])
  expect(allowed.warnings).toEqual([expect.stringContaining('frame-records grew while the command ran')])
})

test('a run that found no input fails: a mistyped path must not pass', async () => {
  const result = await acceptSession({ ...(await night()), recordingDir: '/nonexistent/recording', frameRecordsFile: null, savedImagesDir: null })

  expect(result.problems).toEqual(['no input was found, so nothing was checked'])
})
