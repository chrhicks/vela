import { describe, expect, it } from 'vitest'
import { createIndiImporter, decodeManifest, rigId, sourceId, type RigEvent } from '@vela/rig-events'
import { syntheticSite } from '@vela/rig-testing'

const instanceId = '11111111-1111-4111-8111-111111111111'

const manifest = decodeManifest({
  instanceId,
  devices: [
    { id: 'primary', kind: 'camera', indiDevice: 'Synthetic camera' },
    { id: 'mount', kind: 'mount', indiDevice: 'Synthetic mount' },
  ],
})

const start = 1_792_000_000_000

const importer = () => createIndiImporter({ rig: rigId('test-rig'), source: sourceId('import:indi-test'), manifest })

type Value = string | number

function vector(verb: 'def' | 'set', kind: 'Number' | 'Switch' | 'Text', name: string, state: string, elements: Record<string, Value>, extra = '', device = 'Synthetic mount') {
  const head = `${verb}${kind}Vector device="${device}" name="${name}" state="${state}"${verb === 'def' ? ' perm="rw"' : ''}`
  const child = verb === 'def' ? `def${kind}` : `one${kind}`

  const body = Object.entries(elements)
    .map(([element, value]) => `<${child} name="${element}" label="${element}">\n${value}\n</${child}>`)
    .join('')

  return `<${head}${extra}>${body}</${head.split(' ')[0]}>`
}

const message = (at: number, xml: string, dir: 'in' | 'out' = 'in') => JSON.stringify({ k: 'msg', t: at - start, at, conn: 1, dir, n: 0, xml })

const connect = (at: number) => message(at, vector('def', 'Switch', 'CONNECTION', 'Ok', { CONNECT: 'On', DISCONNECT: 'Off' }))

const coordinates = (verb: 'def' | 'set', at: number, state: string, ra: Value, dec: Value, name = 'EQUATORIAL_EOD_COORD') =>
  message(at, vector(verb, 'Number', name, state, { RA: ra, DEC: dec }))

const site = message(
  start + 5,
  vector('def', 'Number', 'GEOGRAPHIC_COORD', 'Ok', {
    LAT: syntheticSite.latitudeDegrees,
    LONG: (syntheticSite.longitudeDegrees + 360) % 360,
    ELEV: syntheticSite.elevationMeters,
  }),
)

function readAll(lines: readonly string[], into = importer()): RigEvent[] {
  return lines.flatMap(line => {
    const result = into.read(line)

    if (result === undefined) return []

    if (!result.ok) throw new Error(result.error)

    return [result.event]
  })
}

function mountOf(event: RigEvent | undefined) {
  const device = event?.kind === 'cria.state' ? event.body.state.devices[0] : undefined

  if (device?.kind !== 'mount') throw new Error('no mount in the event')

  return device
}

describe('the INDI recording importer', () => {
  it('reads the mount as slewing while its coordinates are Busy', () => {
    const events = readAll([
      connect(start),
      coordinates('def', start + 10, 'Idle', 5.5, -5),
      coordinates('set', start + 1000, 'Busy', 5.6, -5),
      coordinates('set', start + 2000, 'Ok', 5.7, -5),
    ])

    expect(events.slice(1).map(event => mountOf(event).readings.slewing)).toMatchObject([
      { status: 'fresh', value: false },
      { status: 'fresh', value: true },
      { status: 'fresh', value: false },
    ])
  })

  it('reads the J2000 coordinates when the mount has no EOD ones, and prefers EOD when it has both', () => {
    const [, j2000] = readAll([connect(start), coordinates('def', start + 10, 'Busy', 1, 2, 'EQUATORIAL_COORD')])
    const both = readAll([connect(start), coordinates('def', start + 10, 'Idle', 1, 2, 'EQUATORIAL_COORD'), coordinates('def', start + 20, 'Busy', 3, 4)])

    expect(mountOf(j2000).readings).toMatchObject({ coordinateSystem: { value: 'j2000' }, slewing: { value: true }, rightAscensionHours: { value: 1 } })
    expect(mountOf(both.at(-1)).readings).toMatchObject({ coordinateSystem: { value: 'topocentric' }, slewing: { value: true }, rightAscensionHours: { value: 3 } })
  })

  it('keeps the position fresh through an Alert on its coordinates and marks other properties stale', () => {
    const events = readAll([
      connect(start),
      coordinates('def', start + 10, 'Idle', 5.5, -5),
      message(start + 20, vector('def', 'Switch', 'TELESCOPE_TRACK_STATE', 'Idle', { TRACK_ON: 'On', TRACK_OFF: 'Off' })),
      coordinates('set', start + 30, 'Alert', 5.5, -5),
      message(start + 40, vector('set', 'Switch', 'TELESCOPE_TRACK_STATE', 'Alert', { TRACK_ON: 'On', TRACK_OFF: 'Off' })),
    ])

    expect(mountOf(events.at(-2)).readings).toMatchObject({ rightAscensionHours: { status: 'fresh' }, slewing: { status: 'fresh', value: false } })
    expect(mountOf(events.at(-1)).readings).toMatchObject({ tracking: { status: 'stale', value: true } })
  })

  it('marks every state qualified and stamps it with the time of the message that produced it', () => {
    const events = readAll([connect(start), coordinates('def', start + 10, 'Idle', 5.5, -5), coordinates('set', start + 1000, 'Ok', 5.6, -5)])

    expect(events.map(event => event.kind === 'cria.state' && event.body.freshness)).toEqual(['qualified', 'qualified', 'qualified'])
    expect(events.map(event => [event.at, event.seenAt])).toEqual([[start, start], [start + 10, start + 10], [start + 1000, start + 1000]])
    expect(mountOf(events[2]).readings.rightAscensionHours).toMatchObject({ observedAt: start + 1000 })
    expect(mountOf(events[2]).readings.declinationDegrees).toMatchObject({ observedAt: start + 1000 })
  })

  it('keeps the observedAt of a property that a later message did not touch', () => {
    const events = readAll([connect(start), coordinates('def', start + 10, 'Idle', 5.5, -5), site, connect(start + 5000)])

    expect(mountOf(events.at(-1)).readings).toMatchObject({
      rightAscensionHours: { observedAt: start + 10 },
      latitudeDegrees: { observedAt: start + 5 },
      connected: { observedAt: start + 5000 },
    })
  })

  it('reads the site and a derived sidereal time from the geographic coordinates', () => {
    const [, state] = readAll([connect(start), site])
    const { readings } = mountOf(state)

    expect(readings.latitudeDegrees).toMatchObject({ status: 'fresh', value: syntheticSite.latitudeDegrees })
    expect(readings.longitudeDegrees).toMatchObject({ status: 'fresh', value: syntheticSite.longitudeDegrees })
    expect(readings.siderealTimeHours).toMatchObject({ status: 'fresh', observedAt: start + 5 })
  })

  it('says not-read until the definitions settle and unsupported after', () => {
    const events = readAll([connect(start), coordinates('def', start + 10, 'Idle', 5.5, -5), coordinates('set', start + 5000, 'Ok', 5.6, -5)])

    expect(mountOf(events[1]).readings.pierSide).toMatchObject({ status: 'unavailable', reason: 'not-read' })
    expect(mountOf(events[2]).readings.pierSide).toMatchObject({ status: 'unavailable', reason: 'unsupported' })
  })

  it('reads sexagesimal numbers, pier side and the advertised axis rates', () => {
    const events = readAll([
      connect(start),
      coordinates('def', start + 10, 'Idle', '5:30:00', '-5:15:00'),
      message(start + 20, vector('def', 'Switch', 'TELESCOPE_PIER_SIDE', 'Idle', { PIER_WEST: 'Off', PIER_EAST: 'On' })),
      message(start + 30, vector('def', 'Switch', 'TELESCOPE_SLEW_RATE', 'Idle', { '1x': 'On', '2x': 'Off', Fast: 'Off' })),
    ])

    expect(mountOf(events[1]).readings).toMatchObject({ rightAscensionHours: { value: 5.5 }, declinationDegrees: { value: -5.25 } })
    expect(mountOf(events[2]).readings.pierSide).toMatchObject({ value: 'east' })
    expect(mountOf(events[3]).readings.primaryAxisRates).toMatchObject({ value: [{ name: '1x' }, { name: '2x' }] })
  })

  it('marks the mount unavailable once indiserver deletes the device', () => {
    const events = readAll([connect(start), coordinates('def', start + 10, 'Idle', 5.5, -5), message(start + 20, '<delProperty device="Synthetic mount"/>')])
    const device = mountOf(events.at(-1))

    expect(device.availability).toMatchObject({ ready: false, reason: 'unavailable' })
    expect(device.readings.rightAscensionHours).toMatchObject({ status: 'unavailable', reason: 'failed' })
  })

  it('reports a disconnected mount', () => {
    const events = readAll([
      connect(start),
      message(start + 10, vector('set', 'Switch', 'CONNECTION', 'Ok', { CONNECT: 'Off', DISCONNECT: 'On' })),
    ])

    expect(mountOf(events[1]).availability).toMatchObject({ ready: false, reason: 'disconnected' })
  })

  it('says nothing for lines that change no mount reading', () => {
    const into = importer()

    const lines = [
      JSON.stringify({ k: 'conn', t: 1, at: start, conn: 1, status: 'connected' }),
      JSON.stringify({ k: 'end', t: 2, at: start }),
      message(start, '<getProperties version="1.7"/>', 'out'),
      message(start, coordinates('def', start, 'Idle', 1, 2), 'out'),
      message(start, vector('def', 'Number', 'EQUATORIAL_EOD_COORD', 'Idle', { RA: 1, DEC: 2 }, '', 'Synthetic camera')),
      message(start, vector('def', 'Number', 'POLLING_PERIOD', 'Ok', { PERIOD_MS: 1000 })),
      message(start, '<newNumberVector device="Synthetic mount" name="EQUATORIAL_EOD_COORD"><oneNumber name="RA">1</oneNumber></newNumberVector>'),
      message(start, vector('set', 'Number', 'EQUATORIAL_EOD_COORD', 'Busy', { RA: 1, DEC: 2 })),
    ]

    expect(lines.map(line => into.read(line))).toEqual(lines.map(() => undefined))
  })

  it('reports a line that is not JSON, not a recording line or not a legal INDI element', () => {
    const into = importer()

    expect(into.read('{broken')).toMatchObject({ ok: false })
    expect(into.read(JSON.stringify({ k: 'mystery', at: start }))).toMatchObject({ ok: false })
    expect(into.read(message(start, vector('def', 'Number', 'EQUATORIAL_EOD_COORD', 'Idle', { RA: 'five', DEC: 2 })))).toMatchObject({ ok: false })
    expect(into.read(message(start, vector('def', 'Number', 'EQUATORIAL_EOD_COORD', 'Dozing', { RA: 1, DEC: 2 })))).toMatchObject({ ok: false })
  })

  it('refuses a recording whose manifest names no mount', () => {
    const noMount = decodeManifest({ instanceId, devices: [{ id: 'primary', kind: 'camera', indiDevice: 'Synthetic camera' }] })

    expect(() => createIndiImporter({ rig: rigId('test-rig'), source: sourceId('import:indi-test'), manifest: noMount })).toThrow('names no mount')
  })

  it('gives the same recording the same ids on every import, and numbers its states from zero', () => {
    const lines = [connect(start), coordinates('def', start + 10, 'Idle', 5.5, -5), coordinates('set', start + 1000, 'Ok', 5.6, -5)]
    const first = readAll(lines)

    expect(readAll(lines).map(event => event.id)).toEqual(first.map(event => event.id))
    expect(new Set(first.map(event => event.id)).size).toBe(3)
    expect(first.map(event => event.kind === 'cria.state' && event.body.state.sequence)).toEqual([0, 1, 2])
  })
})
