import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { syntheticSite } from '@vela/rig-testing'
import { readTrials } from '@vela/rig-frames'
import { dataDirectory, trialRunId, writeTrial } from './support.ts'

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
})
