import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'
import { darkOutlook } from '../astronomy/sun.js'
import { createAlertMonitor, type AlertMonitor } from './monitor.js'
import { NotifierError, type Notification, type Notifier } from './notifier.js'
import type { Site } from '../astronomy/coordinates.js'
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
    readSite?: (signal: AbortSignal) => Promise<Site | null>
    connected?: boolean
    phoneAlertsOn?: boolean
  } = {},
) {
  let clock = Date.parse('2026-10-18T02:00:00Z')
  const { phone, notifier } = fakePhone(() => clock)

  const monitor = createAlertMonitor({
    rigId: 'fra-400',
    rigName: 'FRA 400',
    thresholds: defaultThresholds,
    notifier: options.connected === false ? null : notifier,
    ...(options.phoneAlertsOn !== undefined && { phoneAlertsOn: options.phoneAlertsOn }),
    now: () => clock,
    ...(options.readMount && { readMount: options.readMount }),
    ...(options.readSite && { readSite: options.readSite }),
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
  statistics: { detectedStars: number; medianHfrPixels: number | null }
}

const night: NightFrame[] = JSON.parse(
  readFileSync(new URL('./fixtures/night-20261018-frames.json', import.meta.url), 'utf8'),
).map((row: { capturedAt: string; stars: number; hfrPixels: number | null }) => ({
  time: row.capturedAt.slice(11, 19),
  capturedAt: row.capturedAt,
  at: Date.parse(row.capturedAt),
  statistics: { detectedStars: row.stars, medianHfrPixels: row.hfrPixels },
}))

/** Feeds the night to the monitor as it happened, one frame at a time, up to and including `until`. */
async function replayNight(fixture: ReturnType<typeof watched>, until = '23:59:59') {
  const frames = night.filter(frame => frame.time <= until)

  fixture.at(frames[0]!.at)
  fixture.monitor.runStarted(60)

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
  fixture.monitor.runStarted(60)

  return async (index: number) => {
    fixture.tick(60_000)
    fixture.monitor.frameCaptured({
      capturedAt: new Date(fixture.clock()).toISOString(),
      statistics: { detectedStars: stars, medianHfrPixels: hfr[index] ?? 3 },
    })
    await settle()
  }
}

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
    fixture.monitor.runStarted(60)

    fixture.monitor.runEnded('failed')
    await settle()

    expect(fixture.monitor.view().alerts).toEqual([expect.objectContaining({ id: 'run-failed', level: 'critical' })])
    expect(fixture.phone.emergencies()).toHaveLength(1)

    fixture.tick(60_000)
    fixture.monitor.runStarted(60)
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
    siderealTimeHours: 1,
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

    monitor.runStarted(1800)
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

  it('keeps trying to stop an emergency that Pushover would not cancel, and says so meanwhile', async () => {
    let mount = tracking({ tracking: false })
    const { monitor, phone } = polled(async () => mount)

    monitor.runStarted(1800)
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

      monitor.runStarted(60)
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

      monitor.runStarted(60)
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

      monitor.runStarted(60)
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

    monitor.runStarted(60)
    await vi.advanceTimersByTimeAsync(0)

    expect(monitor.view().unavailable).toEqual(['meridian watch unavailable: pier side'])
  })

  it('treats a mount that will not answer as a rig that went away, and recovers quietly when it answers', async () => {
    let answering = false

    const { monitor, phone } = polled(async () => {
      if (!answering) throw new Error('timed out')

      return tracking()
    })

    monitor.runStarted(1800)
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

    monitor.runStarted(60)
    await vi.advanceTimersByTimeAsync(0)
    monitor.runEnded('stopped')
    monitor.runStarted(60)
    expect(monitor.view().unavailable).toEqual(['meridian watch unavailable: mount readings'])

    finish(tracking({ pierSide: null }))
    await vi.advanceTimersByTimeAsync(0)

    expect(monitor.view().unavailable).toEqual(['meridian watch unavailable: mount readings'])
  })

  it('warns when frames stop coming, but not while autofocus runs inside the run', async () => {
    const { monitor, phone } = polled(async () => tracking())

    monitor.runStarted(60)
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
      monitor.frameCaptured({ capturedAt: new Date().toISOString(), statistics: { detectedStars: stars, medianHfrPixels: 3 } })
    }

    monitor.runStarted(60)

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

      monitor.runStarted(60)

      for (let index = 0; index < 12; index++) {
        if (index === 6) stars = 300

        await vi.advanceTimersByTimeAsync(60_000)
        monitor.frameCaptured({ capturedAt: new Date().toISOString(), statistics: { detectedStars: stars, medianHfrPixels: 3 } })
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

      monitor.runStarted(1800)
      await vi.advanceTimersByTimeAsync(120_000)

      expect(monitor.view().alerts.map(alert => alert.id)).not.toContain('rig-unreachable')
    })
  })
})

// ---------------------------------------------------------------------------
// The phone alerts switch

describe('the phone alerts switch', () => {
  function failedRun(fixture: ReturnType<typeof watched>) {
    fixture.monitor.runStarted(60)
    fixture.monitor.runEnded('failed')

    return settle()
  }

  it('is on until Chris turns it off', () => {
    expect(watched().monitor.view().phoneAlertsOn).toBe(true)
    expect(watched({ phoneAlertsOn: false }).monitor.view().phoneAlertsOn).toBe(false)
  })

  it('sends nothing for an alert raised while off, and still shows it', async () => {
    const fixture = watched({ phoneAlertsOn: false })

    await failedRun(fixture)

    expect(fixture.phone.events).toEqual([])
    expect(fixture.monitor.view().alerts).toEqual([
      expect.objectContaining({ id: 'run-failed', level: 'critical', delivery: { state: 'muted' } }),
    ])
  })

  it('cancels an emergency that is repeating when turned off, and says nothing when the alert clears', async () => {
    const fixture = watched()

    await failedRun(fixture)
    expect(fixture.phone.emergencies()).toHaveLength(1)

    await fixture.monitor.setPhoneAlerts(false)

    expect(fixture.phone.cancels()).toEqual([expect.objectContaining({ receipt: 'receipt-1' })])
    expect(fixture.monitor.view()).toMatchObject({
      phoneAlertsOn: false,
      alerts: [expect.objectContaining({ id: 'run-failed', delivery: { state: 'muted' } })],
    })

    fixture.monitor.runStarted(60)
    await settle()

    expect(fixture.monitor.view().alerts).toEqual([])
    expect(fixture.phone.sends().map(event => event.priority)).toEqual([2])
  })

  it('pages only alerts raised after it comes back on, not the one raised while off', async () => {
    const fixture = watched({ phoneAlertsOn: false })

    await failedRun(fixture)
    await fixture.monitor.setPhoneAlerts(true)
    await settle()

    expect(fixture.phone.events).toEqual([])
    expect(fixture.monitor.view().alerts[0]!.delivery).toEqual({ state: 'muted' })

    await failedRun(fixture)

    expect(fixture.phone.emergencies()).toHaveLength(1)
    expect(fixture.monitor.view().alerts[0]!.delivery).toEqual({ state: 'sent' })
  })

  it('stops a retry that was waiting for the phone when turned off', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const fixture = watched()
    fixture.phone.down = 'Pushover answered HTTP 500'

    await failedRun(fixture)
    expect(fixture.monitor.view().alerts[0]!.delivery.state).toBe('retrying')

    await fixture.monitor.setPhoneAlerts(false)
    fixture.phone.down = null
    fixture.tick(5 * 60_000)
    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(fixture.phone.events).toEqual([])
    expect(fixture.monitor.view().alerts[0]!.delivery).toEqual({ state: 'muted' })
  })

  it('cancels an emergency whose send was still in flight when turned off', async () => {
    const fixture = watched()
    let release!: () => void
    fixture.phone.sendGate = new Promise<void>(resolve => (release = resolve))

    fixture.monitor.runStarted(60)
    fixture.monitor.runEnded('failed')
    await settle()

    const turnedOff = fixture.monitor.setPhoneAlerts(false)

    release()
    await turnedOff

    expect(fixture.phone.emergencies()).toHaveLength(1)
    expect(fixture.phone.cancels()).toEqual([expect.objectContaining({ receipt: 'receipt-1' })])
  })

  it('keeps trying to cancel an emergency the phone would not stop, and says it is still repeating', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const fixture = watched()

    await failedRun(fixture)
    fixture.phone.down = 'could not reach Pushover'

    await fixture.monitor.setPhoneAlerts(false)

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

  it('does not tell the phone an alert cleared when that alert was sent before it was turned off', async () => {
    const fixture = watched()
    const frame = runOf(fixture, [3, 3, 3, 3, 3, 4.5, 4.5])

    for (let index = 0; index < 7; index++) await frame(index)

    expect(fixture.phone.sends().map(event => event.priority)).toEqual([0])

    const sent = fixture.phone.sends().length

    await fixture.monitor.setPhoneAlerts(false)
    fixture.monitor.runEnded('stopped')
    await settle()

    expect(fixture.phone.sends()).toHaveLength(sent)
  })

  it('refuses a test while off', async () => {
    const fixture = watched({ phoneAlertsOn: false })

    expect(await fixture.monitor.sendTest()).toEqual({ outcome: 'off' })
    expect(fixture.phone.events).toEqual([])
  })
})

describe('paging only in astronomical darkness', () => {
  const greenwich: Site = { latitudeDegrees: 51.4769, longitudeDegrees: -0.0005 }

  const noon = Date.parse('2026-10-18T12:00:00Z')
  const outlook = darkOutlook(greenwich, new Date(noon))

  if (outlook.dark || !outlook.from || !outlook.until) throw new Error('expected a dusk and a dawn at Greenwich in October')

  const dusk = outlook.from.getTime()
  const dawn = outlook.until.getTime()
  const afterDawn = darkOutlook(greenwich, new Date(dawn + 3_600_000))

  if (afterDawn.dark || !afterDawn.from) throw new Error('expected a second dusk')

  const secondDusk = afterDawn.from.getTime()

  /** A rig whose mount reports Greenwich, with the clock at `time` and the site already read. */
  async function atGreenwich(time: number, options: Parameters<typeof watched>[0] = {}) {
    const fixture = watched({ readSite: async () => greenwich, ...options })

    fixture.at(time)
    await fixture.monitor.learnSite()

    return fixture
  }

  function failedRun(fixture: ReturnType<typeof watched>) {
    fixture.monitor.runStarted(60)
    fixture.monitor.runEnded('failed')

    return settle()
  }

  /** Moves the clock and the timers on together in ten minute steps, as time passes on a server. */
  async function passUntil(fixture: ReturnType<typeof watched>, time: number) {
    while (fixture.clock() < time) {
      const step = Math.min(600_000, time - fixture.clock())

      fixture.tick(step)
      await vi.advanceTimersByTimeAsync(step)
    }
  }

  const deliveryOfFirst = (fixture: ReturnType<typeof watched>) => fixture.monitor.view().alerts[0]!.delivery

  it('sends nothing in daylight, shows the alert with the reason, and says when paging starts', async () => {
    const fixture = await atGreenwich(noon)

    await failedRun(fixture)

    expect(fixture.phone.events).toEqual([])

    expect(fixture.monitor.view()).toMatchObject({
      phoneAlertsOn: true,
      pagingWindow: { state: 'not-dark', from: expect.closeTo(dusk, -4), until: expect.closeTo(dawn, -4) },
      alerts: [expect.objectContaining({ id: 'run-failed', level: 'critical', delivery: { state: 'outside-dark' } })],
    })
  })

  it('sends in astronomical darkness, and says when it stops', async () => {
    const fixture = await atGreenwich(dusk + 3_600_000)

    await failedRun(fixture)

    expect(fixture.phone.emergencies()).toHaveLength(1)
    expect(fixture.monitor.view().pagingWindow).toEqual({ state: 'astro-dark', until: expect.closeTo(dawn, -4) })
    expect(deliveryOfFirst(fixture)).toEqual({ state: 'sent' })
  })

  it('pages an alert still standing when dark begins, once, from the frame that crosses dusk', async () => {
    const fixture = await atGreenwich(dusk - 7.5 * 60_000)
    const frame = runOf(fixture, [3, 3, 3, 3, 3, 7, 7, 7, 7, 7])

    for (let index = 0; index < 7; index++) await frame(index)

    expect(fixture.monitor.view().alerts.map(alert => alert.id)).toEqual(['hfr-bad'])
    expect(fixture.phone.events).toEqual([])
    expect(deliveryOfFirst(fixture)).toEqual({ state: 'outside-dark' })

    await frame(7)

    expect(fixture.phone.emergencies()).toHaveLength(1)
    expect(deliveryOfFirst(fixture)).toEqual({ state: 'sent' })

    await frame(8)
    await frame(9)

    expect(fixture.phone.sends()).toHaveLength(1)
  })

  it('pages at dusk with no frame or poll to notice it, once, for an alert a failed run left standing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const fixture = await atGreenwich(noon)

    await failedRun(fixture)
    await passUntil(fixture, dusk - 60_000)

    expect(fixture.phone.events).toEqual([])

    await passUntil(fixture, dusk + 60_000)

    expect(fixture.phone.emergencies()).toHaveLength(1)
    expect(deliveryOfFirst(fixture)).toEqual({ state: 'sent' })

    await passUntil(fixture, dusk + 1_800_000)

    expect(fixture.phone.sends()).toHaveLength(1)
  })

  it('does not page an alert the evaluation at dusk clears, before the timer has noticed dusk', async () => {
    const fixture = await atGreenwich(noon)

    await failedRun(fixture)
    fixture.at(dusk + 10_000)
    fixture.monitor.runStarted(60)
    await settle()

    expect(fixture.monitor.view().alerts).toEqual([])
    expect(fixture.phone.events).toEqual([])
  })

  it('does not page an alert that cleared before dark', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const fixture = await atGreenwich(noon)

    await failedRun(fixture)
    fixture.monitor.runStarted(60)
    await settle()

    expect(fixture.monitor.view().alerts).toEqual([])

    await passUntil(fixture, dusk + 600_000)

    expect(fixture.phone.events).toEqual([])
  })

  it('counts the hour of retries from dusk, not from when the alert was raised', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const fixture = await atGreenwich(noon)

    await failedRun(fixture)
    fixture.phone.down = 'Pushover answered HTTP 500'
    await passUntil(fixture, dusk + 30_000)

    expect(deliveryOfFirst(fixture)).toMatchObject({ state: 'retrying', failures: 1 })

    const delivery = deliveryOfFirst(fixture)

    if (delivery.state !== 'retrying') throw new Error('expected a retry')

    expect(delivery.giveUpAt).toBeGreaterThan(dusk + 3_500_000)
    expect(delivery.giveUpAt).toBeLessThan(dusk + 3_700_000)
  })

  it('cancels an emergency still repeating when dark ends, and says nothing when the alert clears', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const fixture = await atGreenwich(dawn - 600_000)

    await failedRun(fixture)
    expect(fixture.phone.emergencies()).toHaveLength(1)

    await passUntil(fixture, dawn + 60_000)

    expect(fixture.phone.cancels()).toEqual([expect.objectContaining({ receipt: 'receipt-1' })])
    expect(deliveryOfFirst(fixture)).toEqual({ state: 'outside-dark' })
    expect(fixture.monitor.view().pagingWindow).toMatchObject({ state: 'not-dark', from: secondDusk })

    fixture.monitor.runStarted(60)
    await settle()

    expect(fixture.phone.sends()).toHaveLength(1)
  })

  it('pages an alert that stands through the day again at the next dusk', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const fixture = await atGreenwich(dawn - 600_000)

    await failedRun(fixture)
    await passUntil(fixture, secondDusk - 60_000)

    expect(fixture.phone.emergencies()).toHaveLength(1)
    expect(fixture.phone.cancels()).toHaveLength(1)

    await passUntil(fixture, secondDusk + 60_000)

    expect(fixture.phone.emergencies()).toHaveLength(2)
    expect(deliveryOfFirst(fixture)).toEqual({ state: 'sent' })
  })

  it('does not page again at dusk an alert Chris acknowledged', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const fixture = await atGreenwich(dawn - 600_000)

    await failedRun(fixture)
    await fixture.monitor.acknowledge('run-failed')
    await passUntil(fixture, secondDusk + 600_000)

    expect(fixture.phone.emergencies()).toHaveLength(1)
    expect(deliveryOfFirst(fixture)).toEqual({ state: 'sent' })
  })

  it('does not page an alert Chris acknowledged while it waited for dark', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const fixture = await atGreenwich(noon)

    await failedRun(fixture)
    await fixture.monitor.acknowledge('run-failed')
    await passUntil(fixture, dusk + 600_000)

    expect(fixture.phone.events).toEqual([])
  })

  describe('when the site is not known', () => {
    it('pages at any hour, as it did before, and says the site is unknown', async () => {
      const fixture = watched()

      fixture.at(noon)
      await failedRun(fixture)

      expect(fixture.phone.emergencies()).toHaveLength(1)
      expect(fixture.monitor.view().pagingWindow).toEqual({ state: 'site-unknown' })
    })

    it('pages at any hour when the mount gives no usable location', async () => {
      const fixture = await atGreenwich(noon, { readSite: async () => null })

      await failedRun(fixture)

      expect(fixture.phone.emergencies()).toHaveLength(1)
      expect(fixture.monitor.view().pagingWindow).toEqual({ state: 'site-unknown' })
    })

    it('asks the mount again no sooner than every 30 seconds, and learns the site once it answers', async () => {
      let answer: Site | null = null
      const readSite = vi.fn(async () => answer)
      const fixture = await atGreenwich(noon, { readSite })

      await fixture.monitor.learnSite()
      fixture.tick(29_000)
      await fixture.monitor.learnSite()

      expect(readSite).toHaveBeenCalledTimes(1)

      answer = greenwich
      fixture.tick(2_000)
      await fixture.monitor.learnSite()

      expect(readSite).toHaveBeenCalledTimes(2)
      expect(fixture.monitor.view().pagingWindow.state).toBe('not-dark')

      await fixture.monitor.learnSite()
      expect(readSite).toHaveBeenCalledTimes(2)
    })

    it('keeps paging when the mount will not answer', async () => {
      const fixture = await atGreenwich(noon, {
        readSite: async () => {
          throw new Error('Cria is not answering')
        },
      })

      await failedRun(fixture)

      expect(fixture.phone.emergencies()).toHaveLength(1)
    })

    it('stops what it paged at any hour once the site shows the sun is up', async () => {
      let answer: Site | null = null
      const fixture = await atGreenwich(noon, { readSite: async () => answer })

      await failedRun(fixture)
      expect(fixture.phone.emergencies()).toHaveLength(1)

      answer = greenwich
      fixture.tick(31_000)
      await fixture.monitor.learnSite()
      await settle()

      expect(fixture.phone.cancels()).toEqual([expect.objectContaining({ receipt: 'receipt-1' })])
      expect(deliveryOfFirst(fixture)).toEqual({ state: 'outside-dark' })
    })

    it('forgets a site the mount no longer reports, and pages at any hour again', async () => {
      let answer: Site | null = greenwich
      const fixture = await atGreenwich(noon, { readSite: async () => answer })

      answer = null
      fixture.monitor.runStarted(60)
      await settle()
      fixture.monitor.runEnded('failed')
      await settle()

      expect(fixture.phone.emergencies()).toHaveLength(1)
      expect(fixture.monitor.view().pagingWindow).toEqual({ state: 'site-unknown' })
    })

    it('pages what was held under the old site as soon as the mount says the site is unknown', async () => {
      let answer: Site | null = greenwich
      const fixture = await atGreenwich(noon, { readSite: async () => answer })

      answer = null
      fixture.monitor.runStarted(60)
      fixture.monitor.runEnded('failed')

      expect(fixture.phone.events).toEqual([])

      await settle()

      expect(fixture.phone.emergencies()).toHaveLength(1)
    })

    it('keeps the old site when the mount cannot be reached', async () => {
      let broken = false

      const fixture = await atGreenwich(noon, {
        readSite: async () => {
          if (broken) throw new Error('Cria is not answering')

          return greenwich
        },
      })

      broken = true
      fixture.monitor.runStarted(60)
      await settle()

      expect(fixture.monitor.view().pagingWindow.state).toBe('not-dark')
    })

    it('reads the site again when a run starts, since the mount may have been set since', async () => {
      const readSite = vi.fn(async () => greenwich)
      const fixture = await atGreenwich(noon, { readSite })

      fixture.monitor.runStarted(60)
      await settle()

      expect(readSite).toHaveBeenCalledTimes(2)
    })
  })

  describe('with the phone alerts switch', () => {
    it('off still wins in the dark', async () => {
      const fixture = await atGreenwich(dusk + 3_600_000, { phoneAlertsOn: false })

      await failedRun(fixture)

      expect(fixture.phone.events).toEqual([])
      expect(deliveryOfFirst(fixture)).toEqual({ state: 'muted' })
    })

    it('off keeps an alert that waited for dark from paging at dusk, even if the switch comes back on first', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      const fixture = await atGreenwich(noon)

      await failedRun(fixture)
      await fixture.monitor.setPhoneAlerts(false)

      expect(deliveryOfFirst(fixture)).toEqual({ state: 'muted' })

      await fixture.monitor.setPhoneAlerts(true)
      await passUntil(fixture, dusk + 600_000)

      expect(fixture.phone.events).toEqual([])
      expect(deliveryOfFirst(fixture)).toEqual({ state: 'muted' })
    })

    it('on at dusk pages what waited, and off at dusk does not', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      const fixture = await atGreenwich(noon)

      await failedRun(fixture)
      await passUntil(fixture, dusk + 60_000)

      expect(fixture.phone.emergencies()).toHaveLength(1)

      await fixture.monitor.setPhoneAlerts(false)

      expect(fixture.phone.cancels()).toHaveLength(1)
      expect(deliveryOfFirst(fixture)).toEqual({ state: 'muted' })
    })
  })

  it('sends a test in daylight, because Chris asked for it', async () => {
    const fixture = await atGreenwich(noon)

    expect(await fixture.monitor.sendTest()).toEqual({ outcome: 'delivered' })
    expect(fixture.phone.sends()).toHaveLength(1)
  })

  it('watches nothing when there are no phone keys', async () => {
    const readSite = vi.fn(async () => greenwich)
    const fixture = await atGreenwich(noon, { connected: false, readSite })

    expect(readSite).not.toHaveBeenCalled()
    expect(fixture.monitor.view().pagingWindow).toEqual({ state: 'site-unknown' })
  })
})
