import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'
import { createAlertMonitor, type AlertMonitor } from './monitor.js'
import { NotifierError, type Notification, type Notifier } from './notifier.js'
import { starStatistics } from './test-statistics.js'
import type { CaptureImageStatistics } from '@vela/model/web'
import type { MountReading } from './rules.js'
import { defaultThresholds } from './thresholds.js'

const exporter = new InMemorySpanExporter()

new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }).register()

// ---------------------------------------------------------------------------
// A phone that records what it was told. While `down` is set every call fails.

type PhoneEvent =
  | { kind: 'send'; priority: Notification['priority']; title: string; message: string; at: number }
  | { kind: 'cancel'; receipt: string; at: number }

interface FakePhone {
  events: PhoneEvent[]
  /** When each send was tried, whether or not the phone took it. */
  sendAttempts: number[]
  /** While set, every call fails with this reason. */
  down: string | null
  /** While set, a cancel waits for it before it answers. */
  cancelGate: Promise<void> | null
  /** While set, a send waits for it before it answers. */
  sendGate: Promise<void> | null
  sends(): Array<Extract<PhoneEvent, { kind: 'send' }>>
  cancels(): Array<Extract<PhoneEvent, { kind: 'cancel' }>>
  emergencies(): Array<Extract<PhoneEvent, { kind: 'send' }>>
}

function fakePhone(clock: () => number) {
  const events: PhoneEvent[] = []
  let receipts = 0

  const phone: FakePhone = {
    events,
    sendAttempts: [],
    down: null,
    cancelGate: null,
    sendGate: null,
    sends: () => events.filter(event => event.kind === 'send'),
    cancels: () => events.filter(event => event.kind === 'cancel'),
    emergencies: () => phone.sends().filter(event => event.priority === 2),
  }

  const notifier: Notifier = {
    async send({ priority, title, message }) {
      phone.sendAttempts.push(clock())
      await phone.sendGate

      if (phone.down) throw new NotifierError(phone.down)

      events.push({ kind: 'send', priority, title, message, at: clock() })

      return { receipt: priority === 2 ? `receipt-${++receipts}` : null }
    },
    async cancel(receipt) {
      await phone.cancelGate

      if (phone.down) throw new NotifierError(phone.down)

      events.push({ kind: 'cancel', receipt, at: clock() })
    },
  }

  return { phone, notifier }
}

/** Lets the monitor's queued phone calls finish. */
const settle = () => (vi.isFakeTimers() ? vi.advanceTimersByTimeAsync(0) : new Promise(resolve => setTimeout(resolve, 0)))

function rig(
  options: {
    readMount?: (signal: AbortSignal) => Promise<MountReading | null>
    connected?: boolean
  } = {},
) {
  let clock = Date.parse('2026-10-18T02:00:00Z')
  const { phone, notifier } = fakePhone(() => clock)

  const monitor = createAlertMonitor({
    rigId: 'fra-400',
    rigName: 'FRA 400',
    thresholds: defaultThresholds,
    notifier: options.connected === false ? null : notifier,
    now: () => clock,
    ...(options.readMount && { readMount: options.readMount }),
  })

  return {
    monitor,
    phone,
    at: (time: number) => {
      clock = time
    },
    clock: () => clock,
    tick: (ms: number) => {
      clock += ms
    },
  }
}

const monitors: AlertMonitor[] = []

afterEach(() => {
  for (const monitor of monitors.splice(0)) monitor.close()

  vi.useRealTimers()

  exporter.reset()
})

function watched(options: Parameters<typeof rig>[0] = {}) {
  const fixture = rig(options)
  monitors.push(fixture.monitor)

  return fixture
}

// ---------------------------------------------------------------------------
// The 2026-10-17 night

interface NightFrame {
  time: string
  capturedAt: string
  at: number
  statistics: CaptureImageStatistics
}

const night: NightFrame[] = JSON.parse(
  readFileSync(new URL('./fixtures/night-20261018-frames.json', import.meta.url), 'utf8'),
).map((row: { capturedAt: string; stars: number; hfrPixels: number | null }) => ({
  time: row.capturedAt.slice(11, 19),
  capturedAt: row.capturedAt,
  at: Date.parse(row.capturedAt),
  statistics: starStatistics(row.stars, row.hfrPixels),
}))

/** Feeds the night to the monitor as it happened, one frame at a time, up to and including `until`. */
async function replayNight(fixture: ReturnType<typeof watched>, until = '23:59:59') {
  const frames = night.filter(frame => frame.time <= until)

  fixture.at(frames[0]!.at)
  fixture.monitor.runStarted(60, { imaging: true, unattended: true })

  for (const frame of frames) {
    fixture.at(frame.at)
    fixture.monitor.frameCaptured(frame)
    await settle()
  }
}

const clockTime = (ms: number) => new Date(ms).toISOString().slice(11, 19)

describe('the real night: camera snagged a tripod leg', () => {
  it('sends one emergency for the snag and never repeats it, then cancels it and says cleared', async () => {
    const fixture = watched()
    const { phone } = fixture

    await replayNight(fixture)

    expect(phone.sends().map(event => [clockTime(event.at), event.priority])).toEqual([
      ['03:33:25', 2],
      ['04:14:24', -1],
    ])

    expect(phone.emergencies()).toHaveLength(1)
    expect(phone.cancels()).toEqual([
      { kind: 'cancel', receipt: 'receipt-1', at: night.find(frame => frame.time === '04:14:24')!.at },
    ])
    expect(phone.sends()[1]!.message).toMatch(/^cleared: Star count fell to/)
  })

  it('keeps the drop warning off the phone and the banner while the collapse already covers it', async () => {
    const fixture = watched()

    await replayNight(fixture, '03:39:02')

    expect(fixture.monitor.view().alerts.map(alert => alert.id)).toEqual(['stars-collapsed'])
    expect(fixture.phone.sends().map(event => event.priority)).toEqual([2])
  })

  it('shows the snag as one red alert, hiding the weaker warning it grew from', async () => {
    const fixture = watched()

    await replayNight(fixture, '03:32:17')
    expect(fixture.monitor.view().alerts).toEqual([])

    await replayNight(fixture, '03:33:25')
    expect(fixture.monitor.view().alerts.map(alert => [alert.id, alert.level])).toEqual([['stars-collapsed', 'critical']])
  })

  it('stays quiet through the 49 healthy frames before the snag', async () => {
    const fixture = watched()

    await replayNight(fixture, '03:30:02')

    expect(fixture.phone.events).toEqual([])
    expect(fixture.monitor.view().alerts).toEqual([])
  })

  it('stops the phone repeating when acknowledged, keeps the alert up, and still says cleared', async () => {
    const fixture = watched()

    await replayNight(fixture, '03:33:25')

    expect(await fixture.monitor.acknowledge('stars-collapsed')).toEqual({ outcome: 'acknowledged' })
    expect(fixture.phone.cancels()).toEqual([expect.objectContaining({ receipt: 'receipt-1' })])
    expect(fixture.monitor.view().alerts).toEqual([expect.objectContaining({ id: 'stars-collapsed', acknowledged: true })])

    const afterSnag = night.filter(frame => frame.time > '03:33:25')

    for (const frame of afterSnag) {
      fixture.at(frame.at)
      fixture.monitor.frameCaptured(frame)
    }

    await settle()

    expect(fixture.phone.cancels()).toHaveLength(1)
    expect(fixture.phone.emergencies()).toHaveLength(1)
    expect(fixture.phone.sends().at(-1)).toMatchObject({ priority: -1, message: expect.stringMatching(/^cleared:/) })
  })

  it('traces each episode as raised, delivered and cleared', async () => {
    const fixture = watched()

    await replayNight(fixture)

    const spans = exporter.getFinishedSpans().filter(span => span.name.startsWith('alert.'))
    const named = (name: string) => spans.filter(span => span.name === name).map(span => span.attributes['alert.id'])

    expect(named('alert.raised')).toEqual(['stars-dropping', 'stars-collapsed'])
    expect(named('alert.cleared')).toEqual(['stars-dropping', 'stars-collapsed'])

    expect(
      spans
        .filter(span => span.name === 'alert.delivery')
        .map(span => [span.attributes['alert.id'], span.attributes['alert.delivery.action'], span.attributes['alert.delivery.status']]),
    ).toEqual([
      ['stars-collapsed', 'raise', 'delivered'],
      ['stars-collapsed', 'cancel', 'delivered'],
      ['stars-collapsed', 'clear', 'delivered'],
    ])
  })
})

// ---------------------------------------------------------------------------
// Episodes

function runOf(fixture: ReturnType<typeof watched>, hfr: Array<number | null>, stars = 1200) {
  fixture.monitor.runStarted(60, { imaging: true, unattended: true })

  return async (index: number) => {
    fixture.tick(60_000)
    fixture.monitor.frameCaptured({
      capturedAt: new Date(fixture.clock()).toISOString(),
      statistics: starStatistics(stars, hfr[index] ?? 3),
    })
    await settle()
  }
}

describe('no stars from the first frame', () => {
  async function frames(fixture: ReturnType<typeof watched>, count: number, stars: number) {
    for (let index = 0; index < count; index++) {
      fixture.tick(60_000)
      fixture.monitor.frameCaptured({
        capturedAt: new Date(fixture.clock()).toISOString(),
        statistics: starStatistics(stars, null),
      })
      await settle()
    }
  }

  const raised = (fixture: ReturnType<typeof watched>) => fixture.monitor.view().alerts.map(alert => alert.id)

  it('pages once on the fifth frame, and says cleared when the run ends', async () => {
    const fixture = watched()

    fixture.monitor.runStarted(60, { imaging: true, unattended: true })
    await frames(fixture, 4, 0)
    expect(raised(fixture)).toEqual([])

    await frames(fixture, 1, 0)
    expect(fixture.monitor.view().alerts).toEqual([expect.objectContaining({ id: 'no-stars', level: 'critical', message: 'No stars after 5 frames' })])
    expect(fixture.phone.sends().map(event => [event.message, event.priority])).toEqual([['No stars after 5 frames', 2]])

    await frames(fixture, 3, 0)
    expect(fixture.phone.sends()).toHaveLength(1)

    fixture.monitor.runEnded('stopped')
    await settle()
    expect(raised(fixture)).toEqual([])
    expect(fixture.phone.sends().map(event => event.message)).toEqual(['No stars after 5 frames', 'cleared: No stars after 5 frames'])
  })

  it('clears when the stars come in', async () => {
    const fixture = watched()

    fixture.monitor.runStarted(60, { imaging: true, unattended: true })
    await frames(fixture, 5, 0)
    expect(raised(fixture)).toEqual(['no-stars'])

    await frames(fixture, 3, 90)
    expect(raised(fixture)).toEqual([])
  })

  it('does not count a frame whose statistics are of another algorithm version, or lack the named outputs', async () => {
    const fixture = watched()
    const { strong: _strong, ...withoutStrong } = starStatistics(0, null)

    fixture.monitor.runStarted(60, { imaging: true, unattended: true })

    for (const statistics of [{ ...starStatistics(0, null), algorithm: { version: 2 } }, withoutStrong]) {
      for (let index = 0; index < 8; index++) {
        fixture.tick(60_000)
        fixture.monitor.frameCaptured({ capturedAt: new Date(fixture.clock()).toISOString(), statistics })
        await settle()
      }
    }

    expect(raised(fixture)).toEqual([])
  })

  it('stays quiet for a run that does not save its frames', async () => {
    const fixture = watched()

    fixture.monitor.runStarted(60, { imaging: false, unattended: true })
    await frames(fixture, 8, 0)

    expect(raised(fixture)).toEqual([])
    expect(fixture.phone.sends()).toEqual([])
  })

  it('stays quiet for a single exposure', async () => {
    const fixture = watched()

    fixture.monitor.runStarted(60, { imaging: false, unattended: true })
    await frames(fixture, 1, 0)
    fixture.monitor.runEnded('stopped')

    expect(raised(fixture)).toEqual([])
  })
})

describe('episodes', () => {
  const healthy = [3, 3, 3, 3, 3]

  it('does not buzz again when a focus warning flaps within five minutes, but raises again after', async () => {
    const fixture = watched()
    const frame = runOf(fixture, [...healthy, 4.5, 4.5, 3, 4.5, 4.5, 3, 3, 3, 3, 3, 3, 3, 4.5, 4.5])

    // Two soft frames raise it; one sharp frame clears it.
    for (let index = 0; index < 8; index++) await frame(index)
    expect(fixture.phone.sends().map(event => event.priority)).toEqual([0, -1])

    // Two soft frames three minutes after it cleared are the same episode returning: nothing sent.
    await frame(8)
    await frame(9)
    expect(fixture.monitor.view().alerts).toEqual([])
    expect(fixture.phone.sends()).toHaveLength(2)

    // Past the five minutes, the same trouble is a new episode.
    for (let index = 10; index < 19; index++) await frame(index)
    expect(fixture.monitor.view().alerts.map(alert => alert.id)).toEqual(['hfr-high'])
    expect(fixture.phone.sends().map(event => event.priority)).toEqual([0, -1, 0])
  })

  it('updates the banner text as the figures move without telling the phone again', async () => {
    const fixture = watched()
    const frame = runOf(fixture, [...healthy, 4.5, 4.5, 4.8, 5.2])

    for (let index = 0; index < 9; index++) await frame(index)

    expect(fixture.monitor.view().alerts).toEqual([expect.objectContaining({ id: 'hfr-high', message: expect.stringContaining('5.2') })])
    expect(fixture.phone.sends()).toHaveLength(1)
  })

  it('ends every alert when the run is stopped and tells the phone', async () => {
    const fixture = watched()
    const frame = runOf(fixture, [...healthy, 7, 7])

    for (let index = 0; index < 7; index++) await frame(index)
    expect(fixture.phone.emergencies()).toHaveLength(1)

    fixture.monitor.runEnded('stopped')
    await settle()

    expect(fixture.monitor.view()).toMatchObject({ watching: false, alerts: [] })
    expect(fixture.phone.cancels()).toEqual([expect.objectContaining({ receipt: 'receipt-1' })])
    expect(fixture.phone.sends().at(-1)).toMatchObject({ priority: -1 })
  })

  it('raises run-failed as an emergency when the run fails, and drops it when the next run starts', async () => {
    const fixture = watched()
    fixture.monitor.runStarted(60, { imaging: true, unattended: true })

    fixture.monitor.runEnded('failed')
    await settle()

    expect(fixture.monitor.view().alerts).toEqual([expect.objectContaining({ id: 'run-failed', level: 'critical' })])
    expect(fixture.phone.emergencies()).toHaveLength(1)

    fixture.tick(60_000)
    fixture.monitor.runStarted(60, { imaging: true, unattended: true })
    await settle()

    expect(fixture.monitor.view().alerts).toEqual([])
    expect(fixture.phone.cancels()).toHaveLength(1)

    // A new run that fails right away is not held back by the last one's guard.
    fixture.tick(60_000)
    fixture.monitor.runEnded('failed')
    await settle()

    expect(fixture.phone.emergencies()).toHaveLength(2)
  })

  it('answers an acknowledgement for an alert that is not raised', async () => {
    const fixture = watched()

    expect(await fixture.monitor.acknowledge('stars-collapsed')).toEqual({ outcome: 'not-active' })
  })
})

// ---------------------------------------------------------------------------
// Delivery

describe('phone delivery', () => {
  const snag = [3, 3, 3, 3, 3, 7, 7]

  async function snagged(fixture: ReturnType<typeof watched>) {
    const frame = runOf(fixture, snag)

    for (let index = 0; index < snag.length; index++) await frame(index)
  }

  it('says phone alerts are failing with the reason, keeps the alert up, and sends it once Pushover answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const fixture = watched()
    fixture.phone.down = 'Pushover answered HTTP 500'

    await snagged(fixture)

    expect(fixture.monitor.view().phone).toMatchObject({ state: 'failing', reason: 'Pushover answered HTTP 500' })
    expect(fixture.monitor.view().alerts.map(alert => alert.id)).toEqual(['hfr-bad'])
    expect(fixture.phone.events).toEqual([])

    fixture.phone.down = null
    fixture.tick(30_000)
    await vi.advanceTimersByTimeAsync(30_000)

    // Not yet: a minute has not passed since the last attempt.
    expect(fixture.phone.events).toEqual([])

    fixture.tick(31_000)
    await vi.advanceTimersByTimeAsync(31_000)

    expect(fixture.phone.emergencies()).toHaveLength(1)
    expect(fixture.monitor.view().phone).toEqual({ state: 'ready' })

    const failures = exporter.getFinishedSpans().filter(span => span.name === 'alert.delivery' && span.attributes['alert.delivery.status'] === 'failed')
    expect(failures).toHaveLength(1)
    expect(failures[0]!.attributes['alert.delivery.reason']).toBe('Pushover answered HTTP 500')
  })

  /** Moves the clock and the timers on together, a minute at a time, so a retry sees the time it fires at. */
  async function passMinutes(fixture: ReturnType<typeof watched>, minutes: number) {
    for (let minute = 0; minute < minutes; minute++) {
      fixture.tick(60_000)
      await vi.advanceTimersByTimeAsync(60_000)
    }
  }

  it('backs off between attempts to an alert the phone will not take, up to a five minute pause', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const fixture = watched()
    fixture.phone.down = 'Pushover answered HTTP 503'

    await snagged(fixture)

    const first = fixture.phone.sendAttempts[0]!

    await passMinutes(fixture, 20)

    const minutesAfterFirst = fixture.phone.sendAttempts.map(at => (at - first) / 60_000)

    expect(minutesAfterFirst).toEqual([0, 1, 3, 7, 12, 17])
  })

  it('shows when the next attempt is due and when Vela will stop trying', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const fixture = watched()
    fixture.phone.down = 'Pushover answered HTTP 503'

    await snagged(fixture)

    const [alert] = fixture.monitor.view().alerts

    expect(alert!.delivery).toEqual({
      state: 'retrying',
      failures: 1,
      nextAttemptAt: fixture.phone.sendAttempts[0]! + 60_000,
      giveUpAt: alert!.raisedAt + 3_600_000,
    })

    await passMinutes(fixture, 1)
    expect(fixture.monitor.view().alerts[0]!.delivery).toMatchObject({ state: 'retrying', failures: 2 })

    fixture.phone.down = null
    await passMinutes(fixture, 2)
    expect(fixture.monitor.view().alerts[0]!.delivery).toEqual({ state: 'sent' })
  })

  it('stops retrying an emergency after the hour Pushover would have repeated it, and says so', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const fixture = watched()
    fixture.phone.down = 'Pushover answered HTTP 503'

    await snagged(fixture)
    await passMinutes(fixture, 70)

    const attempts = fixture.phone.sendAttempts.length
    const raisedAt = fixture.monitor.view().alerts[0]!.raisedAt

    expect(fixture.phone.sendAttempts.every(at => at < raisedAt + 3_600_000)).toBe(true)
    expect(fixture.monitor.view().alerts[0]!.delivery).toEqual({ state: 'gave-up', failures: attempts })

    fixture.phone.down = null
    await passMinutes(fixture, 30)

    expect(fixture.phone.sendAttempts).toHaveLength(attempts)
    expect(fixture.phone.events).toEqual([])
    expect(fixture.monitor.view().alerts.map(alert => alert.id)).toEqual(['hfr-bad'])
  })

  it('reports delivery as sent for an alert the phone took and as not configured without keys', async () => {
    const delivered = watched()

    await snagged(delivered)
    expect(delivered.monitor.view().alerts[0]!.delivery).toEqual({ state: 'sent' })

    const keyless = watched({ connected: false })

    await snagged(keyless)
    expect(keyless.monitor.view().alerts[0]!.delivery).toEqual({ state: 'not-configured' })
  })

  it('is not acknowledged while the phone could not be told to stop, so it can be tried again', async () => {
    const fixture = watched()

    await snagged(fixture)

    fixture.phone.down = 'could not reach Pushover'
    expect(await fixture.monitor.acknowledge('hfr-bad')).toEqual({ outcome: 'phone-failed', reason: 'could not reach Pushover' })
    expect(fixture.monitor.view().alerts[0]).toMatchObject({ acknowledged: false })
    expect(fixture.monitor.view().phone).toMatchObject({ state: 'failing' })

    fixture.phone.down = null
    expect(await fixture.monitor.acknowledge('hfr-bad')).toEqual({ outcome: 'acknowledged' })
    expect(fixture.phone.cancels()).toHaveLength(1)
  })

  it('counts an emergency\'s hour from when Pushover took it, not from when the alert began', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const fixture = watched()
    fixture.phone.down = 'could not reach Pushover'

    await snagged(fixture)

    fixture.phone.down = null
    fixture.tick(61 * 60_000)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fixture.phone.emergencies()).toHaveLength(1)

    expect(await fixture.monitor.acknowledge('hfr-bad')).toEqual({ outcome: 'acknowledged' })
    expect(fixture.phone.cancels()).toHaveLength(1)
  })

  it('tells the phone about a weaker alert that is left standing when the stronger one clears', async () => {
    const fixture = watched()
    const frame = runOf(fixture, [3, 3, 3, 3, 3, 7, 7, 4.2])

    for (let index = 0; index < 8; index++) await frame(index)

    expect(fixture.monitor.view().alerts.map(alert => alert.id)).toEqual(['hfr-high'])
    expect(fixture.phone.sends().map(event => event.priority).sort()).toEqual([-1, 0, 2])
  })

  it('does not announce the end of an alert the phone never heard of', async () => {
    const fixture = watched()
    fixture.phone.down = 'timed out after 10 s'

    await snagged(fixture)
    fixture.phone.down = null

    fixture.monitor.runEnded('stopped')
    await settle()

    expect(fixture.phone.events).toEqual([])
  })

  it('shows alerts in Vela only when no keys are configured, and says so', async () => {
    const fixture = watched({ connected: false })

    await snagged(fixture)

    expect(fixture.monitor.view()).toMatchObject({ phone: { state: 'not-configured' }, alerts: [expect.objectContaining({ id: 'hfr-bad' })] })
    expect(await fixture.monitor.sendTest()).toEqual({ outcome: 'not-configured' })
  })

  it('sends the test as a normal message titled with the rig', async () => {
    const fixture = watched()

    expect(await fixture.monitor.sendTest()).toEqual({ outcome: 'delivered' })
    expect(fixture.phone.sends()).toEqual([expect.objectContaining({ priority: 0, title: 'Vela: FRA 400', message: 'test' })])
  })

  it('reports a failed test with its reason', async () => {
    const fixture = watched()
    fixture.phone.down = 'Pushover answered HTTP 429'

    expect(await fixture.monitor.sendTest()).toEqual({ outcome: 'failed', reason: 'Pushover answered HTTP 429' })
    expect(fixture.monitor.view().phone).toMatchObject({ state: 'failing', reason: 'Pushover answered HTTP 429' })
  })

  it('never shows an unexpected error, which could carry a key', async () => {
    const fixture = rig()

    const leaky: Notifier = {
      async send() {
        throw new Error('POST https://api.pushover.net token=secret-token failed')
      },
      async cancel() {},
    }

    const monitor = createAlertMonitor({ rigId: 'x', rigName: 'X', thresholds: defaultThresholds, notifier: leaky, now: fixture.clock })
    monitors.push(monitor)

    expect(await monitor.sendTest()).toEqual({ outcome: 'failed', reason: 'unexpected error' })
    expect(JSON.stringify(monitor.view())).not.toContain('secret-token')
  })
})

// ---------------------------------------------------------------------------
// The mount poll and the clock

describe('while the run is polled', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(Date.parse('2026-10-18T03:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const tracking = (overrides: Partial<MountReading> = {}): MountReading => ({
    tracking: true,
    slewing: false,
    parked: false,
    rightAscensionHours: 2,
    declinationDegrees: 20,
    siderealTimeHours: 1,
    latitudeDegrees: 40,
    pierSide: 'west',
    ...overrides,
  })

  function polled(
    readMount: (signal: AbortSignal) => Promise<MountReading | null>,
    readFocuser?: (signal: AbortSignal) => Promise<number | null>,
  ) {
    const { phone, notifier } = fakePhone(() => Date.now())

    const monitor = createAlertMonitor({
      rigId: 'fra-400',
      rigName: 'FRA 400',
      thresholds: defaultThresholds,
      notifier,
      readMount,
      ...(readFocuser && { readFocuser }),
    })

    monitors.push(monitor)

    return { monitor, phone }
  }

  it('raises an emergency on the second reading of a mount that stopped tracking, once', async () => {
    let mount = tracking()
    const { monitor, phone } = polled(async () => mount)

    monitor.runStarted(1800, { imaging: true, unattended: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(monitor.view().alerts).toEqual([])

    mount = tracking({ tracking: false })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(monitor.view().alerts).toEqual([])

    await vi.advanceTimersByTimeAsync(10_000)
    expect(monitor.view().alerts).toEqual([expect.objectContaining({ id: 'tracking-stopped', level: 'critical' })])

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(phone.emergencies()).toHaveLength(1)

    mount = tracking()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(monitor.view().alerts).toEqual([])
    expect(phone.cancels()).toHaveLength(1)
  })

  it('never raises or pages for tracking stopped on a calibration run, however long the mount stands still', async () => {
    let reads = 0

    const { monitor, phone } = polled(async () => {
      reads++

      return tracking({ tracking: false })
    })

    monitor.runStarted(1800, { imaging: false, calibration: true, unattended: true })
    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(reads).toBeGreaterThan(20)
    expect(monitor.view().alerts).toEqual([])
    expect(phone.sendAttempts).toEqual([])
    expect(phone.events).toEqual([])
  })

  it('pages for tracking stopped on the second reading of a light run whose mount stood still from the start', async () => {
    const { monitor, phone } = polled(async () => tracking({ tracking: false }))

    monitor.runStarted(1800, { imaging: false, unattended: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(monitor.view().alerts).toEqual([])

    await vi.advanceTimersByTimeAsync(10_000)
    expect(monitor.view().alerts).toEqual([expect.objectContaining({ id: 'tracking-stopped', level: 'critical' })])
    expect(phone.emergencies()).toHaveLength(1)
  })

  it('says nothing about tracking when no run is active, because the mount is not read', async () => {
    let reads = 0

    const { monitor, phone } = polled(async () => {
      reads++

      return tracking({ tracking: false })
    })

    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(reads).toBe(0)
    expect(monitor.view().alerts).toEqual([])
    expect(phone.sendAttempts).toEqual([])
  })

  it('keeps trying to stop an emergency that Pushover would not cancel, and says so meanwhile', async () => {
    let mount = tracking({ tracking: false })
    const { monitor, phone } = polled(async () => mount)

    monitor.runStarted(1800, { imaging: true, unattended: true })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(phone.emergencies()).toHaveLength(1)

    phone.down = 'could not reach Pushover'
    mount = tracking()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(monitor.view().alerts).toEqual([])
    expect(monitor.view().phone).toMatchObject({
      state: 'failing',
      reason: 'could not stop an emergency repeating: could not reach Pushover',
    })

    // The "cleared" message getting through later does not mean the repeats stopped.
    phone.down = null
    await monitor.sendTest()
    expect(monitor.view().phone.state).toBe('failing')

    // While the retried cancel is in flight the phone is still repeating.
    let release!: () => void
    const gate = new Promise<void>(resolve => (release = resolve))
    phone.cancelGate = gate
    await vi.advanceTimersByTimeAsync(60_000)
    expect(monitor.view().phone.state).toBe('failing')

    release()
    await vi.advanceTimersByTimeAsync(0)

    expect(phone.cancels()).toHaveLength(1)
    expect(monitor.view().phone).toEqual({ state: 'ready' })
  })

  describe('after the run has ended', () => {
    async function failedDuringOutage() {
      const { monitor, phone } = polled(async () => tracking())

      monitor.runStarted(60, { imaging: true, unattended: true })
      await vi.advanceTimersByTimeAsync(0)

      phone.down = 'Pushover answered HTTP 503'
      monitor.runEnded('failed')
      await vi.advanceTimersByTimeAsync(0)

      expect(monitor.view()).toMatchObject({ watching: false, phone: { state: 'failing' } })
      expect(monitor.view().alerts).toEqual([expect.objectContaining({ id: 'run-failed', level: 'critical' })])

      return { monitor, phone }
    }

    it('keeps retrying an emergency the phone refused, with no run left to drive it, until it gets through', async () => {
      const { monitor, phone } = await failedDuringOutage()

      await vi.advanceTimersByTimeAsync(3 * 60_000)
      expect(phone.emergencies()).toHaveLength(0)

      phone.down = null
      // Attempts came at 0, 1 and 3 minutes; the next is four minutes after the last.
      await vi.advanceTimersByTimeAsync(65_000)
      expect(phone.emergencies()).toHaveLength(0)

      await vi.advanceTimersByTimeAsync(3 * 60_000)

      expect(phone.emergencies()).toHaveLength(1)
      expect(monitor.view().phone).toEqual({ state: 'ready' })

      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(phone.emergencies()).toHaveLength(1)
    })

    it('stops retrying once acknowledged', async () => {
      const { monitor, phone } = await failedDuringOutage()

      expect(await monitor.acknowledge('run-failed')).toEqual({ outcome: 'acknowledged' })

      phone.down = null
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      expect(phone.events).toEqual([])
    })

    it('does not retry an alert the next run has already cleared', async () => {
      const { monitor, phone } = await failedDuringOutage()

      monitor.runStarted(60, { imaging: true, unattended: true })
      phone.down = null
      await vi.advanceTimersByTimeAsync(2 * 60_000)

      expect(monitor.view().alerts).toEqual([])
      expect(phone.sends()).toEqual([])
    })

    it('does not start a retry from a send that was still in flight when the monitor closed', async () => {
      const { monitor, phone } = polled(async () => tracking())
      let release!: () => void
      phone.down = 'Pushover answered HTTP 503'
      phone.sendGate = new Promise<void>(resolve => (release = resolve))

      monitor.runStarted(60, { imaging: true, unattended: true })
      monitor.runEnded('failed')
      await vi.advanceTimersByTimeAsync(0)

      monitor.close()
      release()
      await vi.advanceTimersByTimeAsync(0)

      expect(vi.getTimerCount()).toBe(0)
    })

    it('stops its retries when the monitor closes', async () => {
      const { monitor, phone } = await failedDuringOutage()

      monitor.close()
      phone.down = null
      await vi.advanceTimersByTimeAsync(5 * 60_000)

      expect(phone.events).toEqual([])
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  it('says the meridian watch is unavailable instead of looking safe when the mount does not give its pier side', async () => {
    const { monitor } = polled(async () => tracking({ pierSide: null }))

    monitor.runStarted(60, { imaging: true, unattended: true })
    await vi.advanceTimersByTimeAsync(0)

    expect(monitor.view().unavailable).toEqual(['meridian watch unavailable: pier side'])
  })

  it('treats a mount that will not answer as a rig that went away, and recovers quietly when it answers', async () => {
    let answering = false

    const { monitor, phone } = polled(async () => {
      if (!answering) throw new Error('timed out')

      return tracking()
    })

    monitor.runStarted(1800, { imaging: true, unattended: true })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(monitor.view().alerts).toEqual([])

    await vi.advanceTimersByTimeAsync(10_000)
    expect(monitor.view().alerts).toEqual([expect.objectContaining({ id: 'rig-unreachable', level: 'critical' })])

    answering = true
    await vi.advanceTimersByTimeAsync(10_000)

    expect(monitor.view().alerts).toEqual([])
    expect(phone.emergencies()).toHaveLength(1)
  })

  it('does not let a mount reading from the last run into the next one', async () => {
    let finish!: (reading: MountReading) => void
    const { monitor } = polled(() => new Promise<MountReading>(resolve => (finish = resolve)))

    monitor.runStarted(60, { imaging: true, unattended: true })
    await vi.advanceTimersByTimeAsync(0)
    monitor.runEnded('stopped')
    monitor.runStarted(60, { imaging: true, unattended: true })
    expect(monitor.view().unavailable).toEqual(['meridian watch unavailable: mount readings'])

    finish(tracking({ pierSide: null }))
    await vi.advanceTimersByTimeAsync(0)

    expect(monitor.view().unavailable).toEqual(['meridian watch unavailable: mount readings'])
  })

  it('warns when frames stop coming, but not while autofocus runs inside the run', async () => {
    const { monitor, phone } = polled(async () => tracking())

    monitor.runStarted(60, { imaging: true, unattended: true })
    await vi.advanceTimersByTimeAsync(0)

    monitor.autofocusStarted()
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(monitor.view().alerts).toEqual([])

    // Autofocus ends: the baseline starts over, and the wait for a frame starts from now.
    monitor.autofocusEnded()
    await vi.advanceTimersByTimeAsync(170_000)
    expect(monitor.view().alerts).toEqual([])

    await vi.advanceTimersByTimeAsync(20_000)
    expect(monitor.view().alerts).toEqual([expect.objectContaining({ id: 'frames-stalled', level: 'warn' })])

    monitor.frameCaptured({ capturedAt: new Date().toISOString(), statistics: null })
    await vi.advanceTimersByTimeAsync(0)

    expect(monitor.view().alerts).toEqual([])
    expect(phone.sends().map(event => event.priority)).toEqual([0, -1])
  })

  it('starts the baseline over after autofocus so a different star count is not a collapse', async () => {
    const { monitor, phone } = polled(async () => tracking())
    let stars = 1500

    function frame() {
      monitor.frameCaptured({ capturedAt: new Date().toISOString(), statistics: starStatistics(stars, 3) })
    }

    monitor.runStarted(60, { imaging: true, unattended: true })

    for (let index = 0; index < 6; index++) {
      await vi.advanceTimersByTimeAsync(60_000)
      frame()
    }

    monitor.autofocusStarted()
    monitor.autofocusEnded()
    stars = 300

    for (let index = 0; index < 6; index++) {
      await vi.advanceTimersByTimeAsync(60_000)
      frame()
    }

    expect(monitor.view().alerts).toEqual([])
    expect(phone.sends()).toEqual([])
  })

  describe('when the focuser moves', () => {
    /** Six frames at 1500 stars, then six at 300 as if a refocus had changed the count. */
    async function refocused(readFocuser: (signal: AbortSignal) => Promise<number | null>) {
      const { monitor, phone } = polled(async () => tracking(), readFocuser)
      let stars = 1500

      monitor.runStarted(60, { imaging: true, unattended: true })

      for (let index = 0; index < 12; index++) {
        if (index === 6) stars = 300

        await vi.advanceTimersByTimeAsync(60_000)
        monitor.frameCaptured({ capturedAt: new Date().toISOString(), statistics: starStatistics(stars, 3) })
      }

      return { monitor, phone }
    }

    it('starts the history over so the new count is not read as a fall', async () => {
      let position = 5000

      const { monitor, phone } = await refocused(async () => {
        if (Date.now() >= Date.parse('2026-10-18T03:06:30Z')) position = 5200

        return position
      })

      expect(monitor.view().alerts).toEqual([])
      expect(phone.sends()).toEqual([])
    })

    it('leaves the fall standing when the focuser has not moved', async () => {
      const { monitor } = await refocused(async () => 5000)

      expect(monitor.view().alerts.map(alert => alert.id)).toEqual(['stars-dropping'])
    })

    it('does not mistake a rig with no focuser to read, or a read that failed, for a move', async () => {
      const { monitor: none } = await refocused(async () => null)
      let reads = 0

      const { monitor: failing } = await refocused(async () => {
        if (++reads % 2 === 0) throw new Error('Cria did not answer')

        return 5000
      })

      expect(failing.view().alerts.map(alert => alert.id)).toContain('stars-dropping')
      expect(none.view().alerts.map(alert => alert.id)).toContain('stars-dropping')
    })

    it('does not call a failed focuser read an unreachable rig', async () => {
      const { monitor } = polled(async () => tracking(), async () => {
        throw new Error('Cria did not answer')
      })

      monitor.runStarted(1800, { imaging: true, unattended: true })
      await vi.advanceTimersByTimeAsync(120_000)

      expect(monitor.view().alerts.map(alert => alert.id)).not.toContain('rig-unreachable')
    })
  })
})

// ---------------------------------------------------------------------------
// Unattended

describe('Unattended', () => {
  function failedRun(fixture: ReturnType<typeof watched>, unattended = true) {
    fixture.monitor.runStarted(60, { imaging: true, unattended })
    fixture.monitor.runEnded('failed')

    return settle()
  }

  it('is off for a new run, and the run says so', () => {
    const fixture = watched()

    expect(fixture.monitor.view().unattended).toBe(false)

    fixture.monitor.runStarted(60, { imaging: true })
    expect(fixture.monitor.view().unattended).toBe(false)

    fixture.monitor.runStarted(60, { imaging: true, unattended: true })
    expect(fixture.monitor.view().unattended).toBe(true)

    fixture.monitor.runStarted(60, { imaging: true })
    expect(fixture.monitor.view().unattended).toBe(false)
  })

  it('sends nothing for a run that is not Unattended, and still shows the alert', async () => {
    const fixture = watched()

    await failedRun(fixture, false)

    expect(fixture.phone.events).toEqual([])
    expect(fixture.monitor.view().alerts).toEqual([
      expect.objectContaining({ id: 'run-failed', level: 'critical', delivery: { state: 'attended' } }),
    ])
  })

  it('pages standing alerts once when switched on, and never again for the same alert', async () => {
    const fixture = watched()

    await failedRun(fixture, false)
    await fixture.monitor.setUnattended(true)
    await settle()

    expect(fixture.phone.emergencies()).toHaveLength(1)
    expect(fixture.monitor.view().alerts[0]!.delivery).toEqual({ state: 'sent' })

    await fixture.monitor.setUnattended(true)
    await fixture.monitor.setUnattended(false)
    await fixture.monitor.setUnattended(true)
    await settle()

    expect(fixture.phone.emergencies()).toHaveLength(1)
  })

  it('does not page a standing alert Chris acknowledged before switching on', async () => {
    const fixture = watched()

    await failedRun(fixture, false)
    await fixture.monitor.acknowledge('run-failed')
    await fixture.monitor.setUnattended(true)
    await settle()

    expect(fixture.phone.events).toEqual([])
  })

  it('pages the stronger alert when switched on, and not the weaker one it covers', async () => {
    const fixture = watched()
    const frame = runOf(fixture, [3, 3, 3, 3, 3, 7, 7, 7, 7])

    fixture.monitor.runStarted(60, { imaging: true })

    for (let index = 0; index < 9; index++) await frame(index)

    await fixture.monitor.setUnattended(true)
    await settle()

    expect(fixture.phone.sends().map(event => event.message)).toEqual([expect.stringContaining('HFR 7.0')])
  })

  it('cancels an emergency that is repeating when switched off, and says nothing when the alert clears', async () => {
    const fixture = watched()

    await failedRun(fixture)
    expect(fixture.phone.emergencies()).toHaveLength(1)

    await fixture.monitor.setUnattended(false)

    expect(fixture.phone.cancels()).toEqual([expect.objectContaining({ receipt: 'receipt-1' })])
    expect(fixture.monitor.view()).toMatchObject({
      unattended: false,
      alerts: [expect.objectContaining({ id: 'run-failed', delivery: { state: 'stopped' } })],
    })

    fixture.monitor.runStarted(60, { imaging: true })
    await settle()

    expect(fixture.monitor.view().alerts).toEqual([])
    expect(fixture.phone.sends().map(event => event.priority)).toEqual([2])
  })

  it('does not page again an emergency that was paged and then switched off, however often it is switched on', async () => {
    const fixture = watched()

    await failedRun(fixture)
    await fixture.monitor.setUnattended(false)
    await fixture.monitor.setUnattended(true)
    await settle()

    expect(fixture.phone.emergencies()).toHaveLength(1)
    expect(fixture.monitor.view().alerts[0]!.delivery).toEqual({ state: 'stopped' })
  })

  it('stops a retry that was waiting for the phone when switched off, and pages it when switched on', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const fixture = watched()
    fixture.phone.down = 'Pushover answered HTTP 500'

    await failedRun(fixture)
    expect(fixture.monitor.view().alerts[0]!.delivery.state).toBe('retrying')

    await fixture.monitor.setUnattended(false)
    fixture.phone.down = null
    fixture.tick(5 * 60_000)
    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(fixture.phone.events).toEqual([])
    expect(fixture.monitor.view().alerts[0]!.delivery).toEqual({ state: 'attended' })

    await fixture.monitor.setUnattended(true)
    await settle()

    expect(fixture.phone.emergencies()).toHaveLength(1)
  })

  it('cancels an emergency whose send was still in flight when switched off', async () => {
    const fixture = watched()
    let release!: () => void
    fixture.phone.sendGate = new Promise<void>(resolve => (release = resolve))

    fixture.monitor.runStarted(60, { imaging: true, unattended: true })
    fixture.monitor.runEnded('failed')
    await settle()

    const switchedOff = fixture.monitor.setUnattended(false)

    release()
    await switchedOff

    expect(fixture.phone.emergencies()).toHaveLength(1)
    expect(fixture.phone.cancels()).toEqual([expect.objectContaining({ receipt: 'receipt-1' })])
  })

  it('keeps trying to cancel an emergency the phone would not stop, and says it is still repeating', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const fixture = watched()

    await failedRun(fixture)
    fixture.phone.down = 'could not reach Pushover'

    await fixture.monitor.setUnattended(false)

    expect(fixture.monitor.view().phone).toMatchObject({
      state: 'failing',
      reason: 'could not stop an emergency repeating: could not reach Pushover',
    })

    fixture.phone.down = null
    fixture.tick(61_000)
    await vi.advanceTimersByTimeAsync(61_000)

    expect(fixture.phone.cancels()).toEqual([expect.objectContaining({ receipt: 'receipt-1' })])
    expect(fixture.monitor.view().phone).toEqual({ state: 'ready' })
  })

  it('does not tell the phone an alert cleared when it was switched off after that alert was sent', async () => {
    const fixture = watched()
    const frame = runOf(fixture, [3, 3, 3, 3, 3, 4.5, 4.5])

    for (let index = 0; index < 7; index++) await frame(index)

    expect(fixture.phone.sends().map(event => event.priority)).toEqual([0])

    const sent = fixture.phone.sends().length

    await fixture.monitor.setUnattended(false)
    fixture.monitor.runEnded('stopped')
    await settle()

    expect(fixture.phone.sends()).toHaveLength(sent)
  })

  it('sends the cleared message when it is switched off and on again before the alert clears', async () => {
    const fixture = watched()
    const frame = runOf(fixture, [3, 3, 3, 3, 3, 4.5, 4.5])

    for (let index = 0; index < 7; index++) await frame(index)

    await fixture.monitor.setUnattended(false)
    await fixture.monitor.setUnattended(true)
    fixture.monitor.runEnded('stopped')
    await settle()

    expect(fixture.phone.sends().map(event => event.message)).toEqual([
      expect.stringContaining('HFR 4.5'),
      expect.stringContaining('cleared'),
    ])
  })

  it('pages the failure that ends an Unattended run, and the failure of a run switched on while it ran', async () => {
    const fixture = watched()

    fixture.monitor.runStarted(60, { imaging: true })
    await fixture.monitor.setUnattended(true)
    fixture.monitor.runEnded('failed')
    await settle()

    expect(fixture.phone.emergencies()).toHaveLength(1)
  })

  it('sends a test whatever the run', async () => {
    const fixture = watched()

    fixture.monitor.runStarted(60, { imaging: true })

    expect(await fixture.monitor.sendTest()).toEqual({ outcome: 'delivered' })
    expect(fixture.phone.sends()).toHaveLength(1)
  })

  it('has no phone to page without keys, and says so', async () => {
    const fixture = watched({ connected: false })

    await failedRun(fixture)

    expect(fixture.monitor.view().alerts[0]!.delivery).toEqual({ state: 'not-configured' })
    expect(await fixture.monitor.sendTest()).toEqual({ outcome: 'not-configured' })
  })
})

// ---------------------------------------------------------------------------
// A server restart ends the run

describe('an interrupted run', () => {
  const message = 'Capture was interrupted: Vela restarted (12 of 30 frames taken)'

  it('pages an Unattended run with one run-interrupted emergency, and drops it when the next run starts', async () => {
    const fixture = watched()

    fixture.monitor.runInterrupted(message, true)
    await settle()

    expect(fixture.monitor.view()).toMatchObject({
      unattended: true,
      alerts: [expect.objectContaining({ id: 'run-interrupted', level: 'critical', message })],
    })

    expect(fixture.phone.emergencies()).toHaveLength(1)

    fixture.tick(60_000)
    fixture.monitor.runStarted(60, { imaging: true })
    await settle()

    expect(fixture.monitor.view().alerts).toEqual([])
    expect(fixture.phone.cancels()).toHaveLength(1)
  })

  it('shows the alert but does not page a run that was not Unattended', async () => {
    const fixture = watched()

    fixture.monitor.runInterrupted(message, false)
    await settle()

    expect(fixture.phone.events).toEqual([])

    expect(fixture.monitor.view().alerts).toEqual([
      expect.objectContaining({ id: 'run-interrupted', delivery: { state: 'attended' } }),
    ])
  })
})
