import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readLabels } from './labels.ts'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'star-bench-labels-'))
})

afterEach(() => rm(directory, { recursive: true, force: true }))

interface LabelFile {
  night: string
  target: string
  exposureSeconds: number
  use: string
  windows: Array<Record<string, string | string[]>>
}

const night: LabelFile = {
  night: 'Fixture night',
  target: 'Fixture Nebula',
  exposureSeconds: 90,
  use: 'calibration',
  windows: [
    { kind: 'healthy', from: '2030-01-01T02:00:00Z', to: '2030-01-01T02:30:00Z', note: 'quiet' },
    { kind: 'event', name: 'haze', from: '2030-01-01T02:30:00Z', to: '2030-01-01T02:50:00Z', expect: ['stars-dropping'], note: 'haze' },
  ],
}

async function write(name: string, content: LabelFile) {
  await writeFile(join(directory, name), JSON.stringify(content))
}

describe('readLabels', () => {
  it('reads each night with its times as epoch milliseconds', async () => {
    await write('a.json', night)

    const [read] = await readLabels(directory)

    expect(read).toMatchObject({ night: 'Fixture night', use: 'calibration', file: 'a.json' })
    expect(read!.windows[1]).toMatchObject({ kind: 'event', from: Date.parse('2030-01-01T02:30:00Z'), expect: ['stars-dropping'] })
  })

  it('refuses a window that overlaps the one before it, a bad time, and an alert it does not know', async () => {
    const overlapping = { ...night, windows: [night.windows[0]!, { ...night.windows[1]!, from: '2030-01-01T02:20:00Z' }] }
    await write('overlap.json', overlapping)
    await expect(readLabels(directory)).rejects.toThrow('overlap.json')
    await rm(join(directory, 'overlap.json'))

    await write('time.json', { ...night, windows: [{ ...night.windows[0]!, from: 'yesterday' }] })
    await expect(readLabels(directory)).rejects.toThrow('time.json')
    await rm(join(directory, 'time.json'))

    await write('alert.json', { ...night, windows: [{ ...night.windows[1]!, expect: ['stars-vanished'] }] })
    await expect(readLabels(directory)).rejects.toThrow('alert.json')
  })

  it('refuses an event that expects nothing, so an event cannot pass by saying nothing', async () => {
    await write('empty.json', { ...night, windows: [{ ...night.windows[1]!, expect: [] }] })

    await expect(readLabels(directory)).rejects.toThrow('empty.json')
  })

  it('refuses a directory with no label files rather than reporting no failures', async () => {
    await expect(readLabels(directory)).rejects.toThrow('no label files')
  })

  it('reads the committed labels', async () => {
    const committed = join(dirname(fileURLToPath(import.meta.url)), '..', 'labels')
    const nights = await readLabels(committed)

    expect(nights.map(read => read.use).sort()).toEqual(['calibration', 'calibration', 'calibration', 'holdout', 'holdout'])
    expect(nights.flatMap(read => read.windows.filter(window => window.kind === 'event').map(window => window.name))).toEqual(
      expect.arrayContaining(['haze', 'flash', 'camera snag']),
    )
  })
})
