import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openFilePhoneAlertsPreference } from './preference.js'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vela-phone-alerts-'))
})

afterEach(() => rm(directory, { recursive: true, force: true }))

describe('the phone alerts preference file', () => {
  it('is on for every rig when there is no file', async () => {
    const preference = await openFilePhoneAlertsPreference(join(directory, 'phone-alerts.json'))

    expect(preference.isOn('rig-1')).toBe(true)
  })

  it('remembers each rig’s choice when opened again', async () => {
    const path = join(directory, 'nested', 'phone-alerts.json')
    const preference = await openFilePhoneAlertsPreference(path)

    await preference.set('rig-1', false)
    await preference.set('rig-2', true)
    await preference.set('rig-2', false)
    await preference.set('rig-2', true)

    const reopened = await openFilePhoneAlertsPreference(path)

    expect(reopened.isOn('rig-1')).toBe(false)
    expect(reopened.isOn('rig-2')).toBe(true)
    expect(reopened.isOn('rig-3')).toBe(true)
  })

  it('keeps every choice when several rigs change at once', async () => {
    const path = join(directory, 'phone-alerts.json')
    const preference = await openFilePhoneAlertsPreference(path)

    await Promise.all(['a', 'b', 'c', 'd'].map(rig => preference.set(rig, false)))

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ phoneAlerts: { a: false, b: false, c: false, d: false } })
  })

  it('does not change the answer when the write fails', async () => {
    const path = join(directory, 'phone-alerts.json')
    const preference = await openFilePhoneAlertsPreference(path)

    await mkdir(path)
    await expect(preference.set('rig-1', false)).rejects.toThrow()
    expect(preference.isOn('rig-1')).toBe(true)
  })

  it('refuses a file it cannot read, rather than paging a phone Chris turned off', async () => {
    const path = join(directory, 'phone-alerts.json')

    await writeFile(path, '{ nope')
    await expect(openFilePhoneAlertsPreference(path)).rejects.toThrow(/Invalid phone alerts preference.*Invalid JSON/)

    await writeFile(path, JSON.stringify({ phoneAlerts: { 'rig-1': 'off' } }))
    await expect(openFilePhoneAlertsPreference(path)).rejects.toThrow(/Invalid phone alerts preference/)
  })
})
