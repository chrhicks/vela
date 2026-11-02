import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { syntheticSite } from '@vela/rig-testing'
import { readTrials } from '@vela/rig-frames'
import { dataDirectory, loggedRunId, rigName, trialRunId, writeLoggedTrial, writeTrial } from './support.ts'

const root = (dir: string) => join(dir, 'alignment-diagnostics/trials')

describe('readTrials', () => {
  it('summarises a trial: outcome, counts and which frame files are still on disk', async () => {
    const dir = await dataDirectory()
    await writeTrial(dir, { createdAt: '2026-10-26T23:38:03.990Z', outcome: 'finished', adjusting: 3 })

    const { trials, problems } = await readTrials(root(dir))
    const [trial] = trials

    expect(problems).toEqual([])
    expect(trials).toHaveLength(1)
    expect(trial?.runId).toBe(trialRunId)
    expect([trial?.mode, trial?.outcome, trial?.baselines, trial?.measurements, trial?.exposureSeconds]).toEqual(['physical', 'finished', 1, 3, 2])
    expect(trial?.frames.map(frame => [frame.phase, frame.onDisk])).toEqual([
      ['baseline', true],
      ['baseline', true],
      ['baseline', true],
      ['adjusting', false],
      ['adjusting', false],
      ['adjusting', true],
    ])
    expect(trial?.frames[0]?.fileId).toBe('11111111-1111-4111-8111-111111111111')
    expect(trial?.frames[0]?.solved.wcs.cd).toHaveLength(4)
  })

  it('reads the polar error each baseline and measurement gave, at the time of its last sample, and nothing of the site', async () => {
    const dir = await dataDirectory()
    await writeTrial(dir, { createdAt: '2026-10-26T23:38:03.990Z', outcome: 'finished', adjusting: 3 })

    const { trials, problems } = await readTrials(root(dir))
    const [trial] = trials

    expect(problems).toEqual([])
    expect(trial?.readings.map(reading => [reading.phase, reading.at, reading.altitudeArcsec, reading.azimuthArcsec, reading.totalArcsec])).toEqual([
      ['baseline', Date.parse('2026-10-26T23:38:36.936Z'), 1, 2, 2.2],
      ['adjusting', Date.parse('2026-10-26T23:38:36.936Z'), 1, 2, 2.2],
      ['adjusting', Date.parse('2026-10-26T23:38:36.936Z'), 1, 2, 2.2],
      ['adjusting', Date.parse('2026-10-26T23:38:36.936Z'), 1, 2, 2.2],
    ])
    expect(JSON.stringify(trial?.readings)).not.toContain(String(syntheticSite.latitudeDegrees))
  })

  it('calls a trial with no outcome line unfinished and lists trials oldest first', async () => {
    const dir = await dataDirectory()
    await writeTrial(dir, { runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', createdAt: '2026-10-27T01:30:00.000Z' })
    await writeTrial(dir, { runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', createdAt: '2026-10-26T23:30:00.000Z', outcome: 'stopped' })

    const { trials } = await readTrials(root(dir))

    expect(trials.map(trial => [trial.runId.slice(0, 2), trial.outcome])).toEqual([
      ['aa', 'stopped'],
      ['bb', 'unfinished'],
    ])
  })

  it('carries none of the site out of a journal that holds it', async () => {
    const dir = await dataDirectory()
    const directory = await writeTrial(dir, { createdAt: '2026-10-26T23:38:03.990Z', outcome: 'finished' })
    const journal = await readFile(join(directory, 'journal.jsonl'), 'utf8')
    const text = JSON.stringify(await readTrials(root(dir)))

    expect(journal).toContain(String(syntheticSite.longitudeDegrees))

    for (const value of [syntheticSite.latitudeDegrees, syntheticSite.longitudeDegrees, syntheticSite.elevationMeters, 211.75, 'siderealTime', 'latitude', 'longitude'])
      expect(text).not.toContain(String(value))
  })

  it('reports a damaged line by number without quoting it, and keeps the rest', async () => {
    const dir = await dataDirectory()
    const directory = await writeTrial(dir, { createdAt: '2026-10-26T23:38:03.990Z', outcome: 'finished', extraLines: ['{"type":"frame","secret":"SECRET-TEXT"'] })

    const { trials, problems } = await readTrials(root(dir))

    expect(trials).toHaveLength(1)
    expect(problems).toEqual([{ path: join(directory, 'journal.jsonl'), line: 10, reason: 'not JSON' }])
  })

  it('reports a journal with no run line, and a folder whose name disagrees with its run', async () => {
    const dir = await dataDirectory()
    const bare = await writeTrial(dir, { runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', createdAt: '2026-10-26T23:30:00.000Z' })
    await writeFile(join(bare, 'journal.jsonl'), '{"type":"outcome","phase":"failed","error":"x"}\n')
    const other = await writeTrial(dir, { runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', createdAt: '2026-10-26T23:40:00.000Z' })
    const journal = (await readFile(join(other, 'journal.jsonl'), 'utf8')).replace('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
    await writeFile(join(other, 'journal.jsonl'), journal)

    const { trials, problems } = await readTrials(root(dir))

    expect(trials.map(trial => trial.runId)).toEqual(['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'])
    expect(problems.map(problem => problem.reason).sort()).toEqual(['no readable run line', 'the run id differs from the folder name'])
  })

  it('reads a trial from the run log\'s alignment events beside one from a journal, and nothing of the site', async () => {
    const dir = await dataDirectory()
    const directory = await writeLoggedTrial(dir)
    await writeTrial(dir, { createdAt: '2026-10-26T23:38:03.990Z', outcome: 'finished' })

    const { trials, problems } = await readTrials(root(dir), join(dir, 'run-log'))
    const [journal, logged] = trials

    expect(problems).toEqual([])
    expect(trials.map(trial => trial.runId)).toEqual([trialRunId, loggedRunId])
    expect(logged).toMatchObject({ directory, rigId: rigName, mode: 'offline', createdAt: Date.parse('2026-10-27T01:30:00.000Z'), exposureSeconds: 2, outcome: 'finished', baselines: 0, measurements: 1 })
    expect(logged?.frames.map(frame => [frame.line, frame.phase, frame.position, frame.fileId, frame.onDisk])).toEqual([[2, 'baseline', 1, '55555555-5555-4555-8555-555555555555', true]])
    expect(logged?.fits.map(fit => [fit.line, fit.positions, fit.status])).toEqual([[3, [1], 'rigid']])
    expect(logged?.dropped).toEqual([{ line: 4, position: 2, reason: 'no-solve' }])
    expect(logged?.readings.map(reading => [reading.line, reading.phase, Object.keys(reading).sort()])).toEqual([
      [3, 'baseline', ['altitudeArcsec', 'at', 'azimuthArcsec', 'line', 'phase', 'totalArcsec']],
      [5, 'adjusting', ['altitudeArcsec', 'at', 'azimuthArcsec', 'line', 'phase', 'totalArcsec']],
    ])
    expect(journal?.directory).not.toBe(logged?.directory)

    for (const text of ['41.5', '211.75', 'simulator', 'latitude', 'sidereal']) expect(JSON.stringify(logged)).not.toContain(text)
  })

  it('keeps an event the log wrote twice once, and takes a missing run log as a problem only when one is named', async () => {
    const dir = await dataDirectory()
    await writeLoggedTrial(dir, { duplicate: true })

    const twice = await readTrials(root(dir), join(dir, 'run-log'))
    const missing = await readTrials(root(dir), join(dir, 'no-run-log'))
    const unnamed = await readTrials(root(dir))

    expect(twice.trials[0]?.frames).toHaveLength(1)
    expect(missing.problems[0]).toEqual({ path: join(dir, 'no-run-log'), line: null, reason: 'ENOENT' })
    expect(unnamed.trials).toEqual([])
  })
})
