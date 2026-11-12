import { describe, expect, it } from 'vitest'
import { StreamPosition, type Entry } from '../../state/entry.ts'
import { makeActivity } from './activity.ts'

const titles = { primary: 'Main camera', mount: 'Mount', focuser: 'Focuser' }
const nightOf = (at: number) => (at < 1000 ? '2026-11-07' : '2026-11-08')

function entry(kind: string, body: unknown, at = 10): Entry {
  return { seq: StreamPosition.make(0), kind, at, body }
}

const message = (device: string, text: string, at = 10) => entry('wire', { dir: 'in', device, type: 'message', text }, at)
const connection = (device: string, connect: boolean, at = 10) => entry('wire', { dir: 'in', device, type: 'set', property: 'CONNECTION', state: 'Ok', elements: { CONNECT: connect, DISCONNECT: !connect } }, at)

describe('the night\'s activity', () => {
  it('says what a command asked for and how the rig answered', () => {
    const activity = makeActivity({ titles, nightOf })

    expect(activity.observe(entry('client.command', { id: 'a', by: 'vela', device: 'primary', property: 'CCD_EXPOSURE', result: 'written' }))).toMatchObject({ topic: 'command', tone: 'plain', text: 'Start an exposure (Vela): done.' })
    expect(activity.observe(entry('client.command', { id: 'h', by: 'vela', device: 'mount', property: 'TELESCOPE_HOME', result: 'refused', reason: 'ZWO AM5 is parked: Unpark first' }))?.text).toBe('Mount to Home (Vela): refused, ZWO AM5 is parked: Unpark first.')
    expect(activity.observe(entry('client.command', { id: 'b', by: 'cria', device: 'mount', property: 'GEOGRAPHIC_COORD', result: 'refused', reason: 'the rig file owns GEOGRAPHIC_COORD' }))).toMatchObject({
      tone: 'bad',
      text: 'Write GEOGRAPHIC_COORD to the mount (Cria): refused, the rig file owns GEOGRAPHIC_COORD.',
    })
  })

  it('keeps driver messages without their level, and leaves debug lines out', () => {
    const activity = makeActivity({ titles, nightOf })

    expect(activity.observe(message('mount', '[DEBUG] CMD <:GU#>'))).toBeUndefined()
    expect(activity.observe(message('primary', '[INFO] Taking a 120 seconds frame...'))).toMatchObject({ topic: 'driver', tone: 'plain', text: 'Main camera: Taking a 120 seconds frame...' })
    expect(activity.observe(message('primary', '[WARNING] Telescope aperture is missing.'))).toMatchObject({ tone: 'warn' })
    expect(activity.observe(message('other', '[INFO] HotPlugManager: Created new ASICCD device'))).toMatchObject({ text: 'INDI: HotPlugManager: Created new ASICCD device' })
  })

  it('tells when a device connects and disconnects, once per change', () => {
    const activity = makeActivity({ titles, nightOf })

    expect(activity.observe(connection('focuser', true))).toMatchObject({ topic: 'device', tone: 'good', text: 'The focuser connected.', link: '#/rig' })
    expect(activity.observe(connection('focuser', true))).toBeUndefined()
    expect(activity.observe(connection('focuser', false))).toMatchObject({ tone: 'bad', text: 'The focuser disconnected.' })
  })

  it('tells a run from start to end, with each kept frame linking to its page', () => {
    const activity = makeActivity({ titles, nightOf })

    expect(activity.observe(entry('vela.run.started', { run: 'r', object: 'M 31', frameType: 'light', exposureSeconds: 120, count: 10, gain: 100, offset: 50 }, 2000))?.text).toBe('Run started: 10 light frames of M 31, 120 s each, gain 100, offset 50.')
    expect(activity.observe(entry('vela.run.exposed', { run: 'r', frame: 1 }, 2001))).toBeUndefined()
    expect(activity.observe(entry('vela.frame', { file: 'm31_light_001.fits', night: '2026-11-08', bytes: 52428800, sha256: 'ab' }, 2002))).toMatchObject({
      text: "Kept m31_light_001.fits (50.0 MB), checked against the rig's copy.",
      link: '#/frames/2026-11-08/m31_light_001.fits',
    })
    expect(activity.observe(entry('vela.run.failed', { run: 'r', attempt: 2, why: 'the camera reported an alert' }, 2003))).toMatchObject({ tone: 'warn', text: 'An exposure failed: the camera reported an alert.' })
    expect(activity.observe(entry('vela.run.ended', { run: 'r', reason: 'done', detail: '1 frames', counted: 1 }, 2004))?.text).toBe('Run finished: 1 frame.')
    expect(activity.observe(entry('vela.run.ended', { run: 'r', reason: 'failures', detail: '3 exposures in a row failed' }, 2004))).toMatchObject({ tone: 'bad', text: 'Run ended early: 3 exposures in a row failed.' })
  })

  it('shows only tonight: a new night starts an empty list', () => {
    const activity = makeActivity({ titles, nightOf })

    activity.observe(message('primary', '[INFO] last night', 500))
    expect(activity.view(500).items).toHaveLength(1)

    activity.observe(message('primary', '[INFO] tonight', 1500))
    expect(activity.view(1500)).toMatchObject({ night: '2026-11-08', items: [{ text: 'Main camera: tonight' }] })
    expect(activity.view(500).items).toEqual([])
  })

  it('tells the rig program starting and the INDI server and PHD2 coming and going', () => {
    const activity = makeActivity({ titles, nightOf })

    expect(activity.observe(entry('client.connected', { client: 'rig', version: '7f7a40e' }))?.text).toBe('The rig program started (version 7f7a40e).')
    expect(activity.observe(entry('client.connection', { target: 'indiserver', status: 'closed' }))).toMatchObject({ tone: 'bad', text: 'Lost the INDI server.' })
    expect(activity.observe(entry('client.connection', { target: 'phd2', status: 'failed' }))).toMatchObject({ tone: 'warn', text: 'Could not reach PHD2.' })
    expect(activity.observe(entry('phd2.event', { Event: 'StarLost' }))).toMatchObject({ tone: 'warn', text: 'Guiding lost the star.' })
    expect(activity.observe(entry('phd2.event', { Event: 'GuideStep' }))).toBeUndefined()
  })
})
