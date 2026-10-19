import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAlertsConfiguration } from './config.js'

const directories: string[] = []

async function configurationFile(contents?: string) {
  const directory = await mkdtemp(join(tmpdir(), 'vela-alerts-'))
  const path = join(directory, 'alerts.json')

  directories.push(directory)

  if (contents !== undefined) await writeFile(path, contents)

  return path
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('alerts configuration', () => {
  it('keeps banner-only alerts and rule defaults when no configuration path is supplied', async () => {
    const configuration = await loadAlertsConfiguration(undefined)

    expect(configuration.pushover).toBeNull()
    expect(configuration.thresholds).toMatchObject({
      baselineFrames: 5,
      minBaselineFrames: 3,
      starsLowRatio: 0.6,
      hfrHighPixels: 4,
      meridianTrackLimitHours: 0.0669,
      rigUnreachableSeconds: 30
    })
  })

  it('keeps banner-only alerts when the optional alerts file does not exist', async () => {
    const path = await configurationFile()

    expect(await loadAlertsConfiguration(path)).toMatchObject({
      pushover: null,
      thresholds: { confirmFrames: 2, meridianNearMinutes: 20 }
    })
  })

  it('does not hide a read failure as missing phone configuration', async () => {
    const path = await configurationFile()
    const directory = join(path, '..')

    await expect(loadAlertsConfiguration(directory)).rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('loads both fake keys while filling omitted threshold numbers from the rule schema', async () => {
    const path = await configurationFile(JSON.stringify({
      pushover: { token: 'fake-token-for-tests', user: 'fake-user-for-tests' },
      thresholds: { hfrBadPixels: 7, meridianTrackLimitHours: 1 }
    }))

    expect(await loadAlertsConfiguration(path)).toMatchObject({
      pushover: { token: 'fake-token-for-tests', user: 'fake-user-for-tests' },
      thresholds: { hfrHighPixels: 4, hfrBadPixels: 7, meridianTrackLimitHours: 1, confirmFrames: 2 }
    })
  })

  it.each(['{}', '{"thresholds":{}}'])('uses default thresholds without requiring phone keys in %s', async contents => {
    const path = await configurationFile(contents)

    expect(await loadAlertsConfiguration(path)).toMatchObject({
      pushover: null,
      thresholds: { baselineFrames: 5, hfrBadPixels: 6, framesStalledGraceSeconds: 30 }
    })
  })

  it.each([
    ['a missing user key', { pushover: { token: 'fake-token-for-tests' } }, 'pushover.user'],
    ['a missing application token', { pushover: { user: 'fake-user-for-tests' } }, 'pushover.token'],
    ['an empty application token', { pushover: { token: '', user: 'fake-user-for-tests' } }, 'pushover.token'],
    ['an empty user key', { pushover: { token: 'fake-token-for-tests', user: '' } }, 'pushover.user'],
    ['unknown root fields', { unexpected: true }, '(root): Unrecognized keys'],
    ['unknown Pushover fields', { pushover: { token: 'fake-token-for-tests', user: 'fake-user-for-tests', unexpected: true } }, 'pushover: Unrecognized keys'],
    ['unknown threshold fields', { thresholds: { unexpected: 4 } }, 'thresholds: Unrecognized keys'],
    ['invalid threshold numbers', { thresholds: { confirmFrames: 0 } }, 'thresholds.confirmFrames'],
    ['contradictory thresholds', { thresholds: { starsCollapsedRatio: 0.9 } }, 'starsCollapsedRatio must be below starsLowRatio']
  ])('rejects %s with the configuration path and the relevant issue', async (_description, input, issue) => {
    const path = await configurationFile(JSON.stringify(input))

    await expect(loadAlertsConfiguration(path)).rejects.toThrow(`Invalid alerts configuration in ${path}:`)
    await expect(loadAlertsConfiguration(path)).rejects.toThrow(issue)
  })

  it('joins schema issues without leaking fake keys in values or unknown field names', async () => {
    const path = await configurationFile(JSON.stringify({
      pushover: { token: 'recognizable-fake-token', user: 7, 'recognizable-fake-token': true },
      thresholds: { hfrHighPixels: 'recognizable-fake-token' },
      'recognizable-fake-token': 'recognizable-fake-token'
    }))

    await expect(loadAlertsConfiguration(path)).rejects.toEqual(new Error(
      `Invalid alerts configuration in ${path}: pushover.user: Invalid input: expected string, received number; pushover: Unrecognized keys; thresholds.hfrHighPixels: Invalid input: expected number, received string; (root): Unrecognized keys`
    ))
  })

  it('replaces JSON parser diagnostics so malformed files cannot expose a fake key', async () => {
    const path = await configurationFile('{"pushover":{"token":"recognizable-fake-token",bad-json}')

    await expect(loadAlertsConfiguration(path)).rejects.toEqual(new Error(
      `Invalid alerts configuration in ${path}: (root): Invalid JSON`
    ))
  })
})
