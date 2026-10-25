import { trace, SpanStatusCode } from '@opentelemetry/api'
import type { CaptureImage, PagingWindow } from '@vela/model/web'
import type { Site } from '../astronomy/coordinates.js'
import { astronomicalDarkDegrees, darkOutlook, sunAltitudeDegrees } from '../astronomy/sun.js'
import { emergencyExpireSeconds, NotifierError, type Notification, type Notifier } from './notifier.js'
import {
  evaluateAlerts,
  type AlertCondition,
  type AlertId,
  type AlertLevel,
  type Frame,
  type MountReading,
  type RunState,
} from './rules.js'
import type { AlertThresholds } from './thresholds.js'

const tracer = trace.getTracer('vela.alerts')

/** A cleared alert may not come back this soon; a flapping HFR must not buzz all night. */
const reRaiseGuardMs = 5 * 60_000

/** How long before a stray emergency's cancel that Pushover refused is tried again. */
const resendAfterFailureMs = 60_000

/**
 * An alert that never reached the phone is tried again after a minute, then after twice the
 * pause each time, never more than five minutes apart. Vela stops once the alert is older than
 * an emergency's hour: Pushover itself would have stopped repeating by then.
 */
const firstRetryMs = 60_000

const longestRetryPauseMs = 5 * 60_000

const giveUpAfterMs = emergencyExpireSeconds * 1000

/** An unknown site is asked for again no sooner than this, so a rig that is off is not asked every second. */
const siteRetryMs = 30_000

/** The sun's crossing is found to a second or so; the timer waits this long past it so the check sees the new side. */
const sunTimerMarginMs = 1_000

/** The longest the sun timer sleeps before it looks again, so a clock that jumped cannot strand it. */
const sunRecheckMs = 6 * 3_600_000

const mountPollMs = 10_000

const mountReadTimeoutMs = 5_000

/**
 * A weaker alert that a stronger one already covers is hidden from the banner and kept
 * off the phone while the stronger one stands. Both still run their own episodes.
 */
const coveredBy: Partial<Record<AlertId, AlertId>> = {
  'stars-dropping': 'stars-collapsed',
  'stars-declining': 'stars-collapsed',
  'hfr-high': 'hfr-bad',
  'meridian-near': 'meridian-imminent',
}

/** How the phone is getting on with one alert. */
export type AlertDelivery =
  | { state: 'sent' | 'sending' | 'covered' | 'not-configured' | 'muted' | 'outside-dark' }
  /** The phone refused it `failures` times. Vela tries again at `nextAttemptAt` and stops at `giveUpAt`. */
  | { state: 'retrying'; failures: number; nextAttemptAt: number; giveUpAt: number }
  /** Vela stopped trying: the hour ran out, or the alert was acknowledged before the phone took it. */
  | { state: 'gave-up'; failures: number }

export interface ActiveAlert {
  id: AlertId
  level: AlertLevel
  message: string
  raisedAt: number
  /** Stops the phone repeating. The alert stays visible until its condition clears. */
  acknowledged: boolean
}

export interface ViewedAlert extends ActiveAlert {
  delivery: AlertDelivery
}

export type PhoneAlerts =
  | { state: 'not-configured' }
  | { state: 'ready' }
  | { state: 'failing'; reason: string; since: number }

export interface AlertsView {
  rigId: string
  /** True while a capture run is being watched. When false, no alerts means nothing is being checked. */
  watching: boolean
  /** Critical first, then oldest first. */
  alerts: ViewedAlert[]
  /** Watches that cannot run right now, such as "meridian watch unavailable: pier side". */
  unavailable: string[]
  phone: PhoneAlerts
  phoneAlertsOn: boolean
  pagingWindow: PagingWindow
  thresholds: AlertThresholds
}

export type AcknowledgeResult =
  | { outcome: 'acknowledged' }
  | { outcome: 'not-active' }
  | { outcome: 'phone-failed'; reason: string }

export type TestResult =
  | { outcome: 'delivered' }
  | { outcome: 'not-configured' }
  | { outcome: 'off' }
  | { outcome: 'failed'; reason: string }

export interface AlertMonitorOptions {
  rigId: string
  rigName: string
  thresholds: AlertThresholds
  notifier: Notifier | null
  /** Off sends nothing to the phone. Defaults to on. */
  phoneAlertsOn?: boolean
  /**
   * Where the rig is, from its mount. The phone is paged only in astronomical darkness at this site.
   * Null, or no reader, means the site is unknown and the phone is paged at any hour.
   */
  readSite?: (signal: AbortSignal) => Promise<Site | null>
  /**
   * A failed read means the rig stopped answering. Null means this rig has no mount to read,
   * so the mount watches report themselves unavailable instead.
   */
  readMount?: (signal: AbortSignal) => Promise<MountReading | null>
  /**
   * The focuser's position, or null when the rig has none to read. A failed read is skipped:
   * the mount read is what says the rig stopped answering.
   */
  readFocuser?: (signal: AbortSignal) => Promise<number | null>
  now?: () => number
  mountPollMs?: number
}

/** One raised alert, from the evaluation that raised it until the one that clears it. */
interface Episode extends ActiveAlert {
  /**
   * Unsent is retried on its own schedule until it gets through, is acknowledged or runs out of
   * time, which makes it gave-up. Skipped was covered by a stronger alert. Muted was silenced
   * by Chris's switch and is never sent, even when the switch comes back on. Held waits for
   * astronomical darkness, and is sent when it begins if the alert still stands.
   */
  delivery: 'unsent' | 'sending' | 'sent' | 'skipped' | 'muted' | 'held' | 'gave-up'
  /** When the phone could first be told: the raise, or the dusk that released it. The retry hour counts from here. */
  eligibleAt: number
  /** Sends the phone refused. */
  failures: number
  /** The pending retry. */
  retry: { readonly at: number; readonly timer: ReturnType<typeof setTimeout> } | null
  /** The open emergency receipt, until it is cancelled. */
  receipt: string | null
  /** When the phone accepted the message. An emergency's hour starts here. */
  sentAt: number | null
  /** Keeps this episode's phone calls in order: raise, then acknowledge, then clear. */
  phoneCalls: Promise<unknown>
}

/** An emergency that kept repeating because Pushover would not take its cancel. */
interface StrayReceipt {
  receipt: string
  sentAt: number
  reason: string
  since: number
}

type Sun = 'dark' | 'light' | 'unknown'

/** Open: the phone may be told. Off is Chris's switch. Not dark: the sun is too high to page. */
type Gate = 'open' | 'off' | 'not-dark'

type PhoneOutcome<T> = { ok: true; value: T } | { ok: false; reason: string }

/**
 * Watches one rig's capture run and turns what the rules find into episodes:
 * one raised, one cleared, and nothing re-sent by Vela while it stands.
 * Fed by the capture controller (frames) and a mount poll while a run is active.
 */
export function createAlertMonitor({
  rigId,
  rigName,
  thresholds,
  notifier,
  phoneAlertsOn = true,
  readMount,
  readFocuser,
  readSite,
  now = Date.now,
  mountPollMs: pollMs = mountPollMs,
}: AlertMonitorOptions) {
  let run: RunState = { status: 'stopped' }
  let runToken = 0
  let autofocusing = false
  let frames: Frame[] = []
  let focuserPosition: number | null = null
  let mountReadings: MountReading[] = []
  let observationsInterruptedSince: number | null = null
  let unavailable: string[] = []
  let phone: PhoneAlerts = notifier ? { state: 'ready' } : { state: 'not-configured' }
  let phoneOn = phoneAlertsOn
  let site: Site | null = null
  let siteTriedAt: number | null = null
  let siteRead: Promise<void> | null = null
  let sunSeen: Sun = 'unknown'
  let sunTimer: ReturnType<typeof setTimeout> | undefined
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let polling = false

  const episodes = new Map<AlertId, Episode>()
  const clearedAt = new Map<AlertId, number>()
  const strayReceipts: StrayReceipt[] = []
  let strayTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  function evaluate() {
    const at = now()

    // The camera is not expected to produce frames during autofocus.
    const watched: RunState =
      run.status === 'running' && autofocusing ? { ...run, waitingForFrameSince: at } : run

    const evaluation = evaluateAlerts(
      { run: watched, frames, mountReadings, observationsInterruptedSince },
      thresholds,
      at,
    )

    unavailable = evaluation.unavailable
    reconcile(evaluation.conditions, at)

    // After reconcile, so an alert this evaluation clears is not released to the phone first.
    syncSun()
  }

  function reconcile(conditions: AlertCondition[], at: number) {
    const current = new Map(conditions.map(condition => [condition.id, condition]))

    for (const episode of episodes.values()) {
      const condition = current.get(episode.id)

      if (condition) episode.message = condition.message
      else clear(episode, at)
    }

    const raised = conditions.flatMap(condition => (episodes.has(condition.id) ? [] : raise(condition, at)))

    for (const episode of raised) announce(episode)

    // A stronger alert that cleared leaves the weaker one it covered standing, and unheard.
    for (const episode of episodes.values()) {
      if (episode.delivery === 'skipped' && !isCovered(episode.id)) sendRaised(episode)
    }
  }

  function raise(condition: AlertCondition, at: number): Episode[] {
    const cleared = clearedAt.get(condition.id)

    if (cleared !== undefined && at - cleared < reRaiseGuardMs) return []

    const episode: Episode = {
      ...condition,
      raisedAt: at,
      acknowledged: false,
      eligibleAt: at,
      delivery: 'unsent',
      failures: 0,
      retry: null,
      receipt: null,
      sentAt: null,
      phoneCalls: Promise.resolve(),
    }

    episodes.set(episode.id, episode)

    tracer
      .startSpan('alert.raised', {
        attributes: { 'alert.rig.id': rigId, 'alert.id': episode.id, 'alert.level': episode.level },
      })
      .end()

    return [episode]
  }

  /** Tells the phone, unless a stronger alert already does. */
  function announce(episode: Episode) {
    if (phoneOn && isCovered(episode.id)) episode.delivery = 'skipped'
    else sendRaised(episode)
  }

  function clear(episode: Episode, at: number) {
    episodes.delete(episode.id)
    clearedAt.set(episode.id, at)
    stopRetrying(episode)

    tracer
      .startSpan('alert.cleared', {
        attributes: {
          'alert.rig.id': rigId,
          'alert.id': episode.id,
          'alert.level': episode.level,
          'alert.duration.ms': at - episode.raisedAt,
          'alert.acknowledged': episode.acknowledged,
        },
      })
      .end()

    afterPreviousCalls(episode, async () => {
      // The phone is only told that an alert ended if it was told that it began.
      if (!notifier || episode.delivery !== 'sent') return

      await cancelOrKeepTrying(episode)

      if (phoneGate() !== 'open') return

      await callPhone('clear', episode.id, -1, () =>
        notifier.send({ title: title(), message: `cleared: ${episode.message}`, priority: -1 }),
      )
    })
  }

  /**
   * An alert that failed to reach the phone is tried again later, on its own timer: a failed run has
   * no polling left to drive it. The pause doubles up to a cap, and the alert is given up once the
   * next try would fall after the hour an emergency lasts.
   */
  function retrySoon(episode: Episode) {
    if (closed) return

    const pause = Math.min(firstRetryMs * 2 ** (episode.failures - 1), longestRetryPauseMs)
    const at = now() + pause

    if (at >= episode.eligibleAt + giveUpAfterMs) {
      episode.delivery = 'gave-up'

      return
    }

    const timer = setTimeout(() => {
      episode.retry = null

      if (episode.delivery === 'unsent') sendRaised(episode)
    }, pause)

    timer.unref()
    episode.retry = { at, timer }
  }

  function stopRetrying(episode: Episode) {
    if (episode.retry) clearTimeout(episode.retry.timer)

    episode.retry = null
  }

  function sendRaised(episode: Episode) {
    if (!notifier) return

    const gate = phoneGate()

    if (gate !== 'open') {
      episode.delivery = closedDelivery(gate)

      return
    }

    episode.delivery = 'sending'

    const notification: Notification = {
      title: title(),
      message: episode.message,
      priority: episode.level === 'critical' ? 2 : 0,
    }

    afterPreviousCalls(episode, async () => {
      const gate = phoneGate()

      if (gate !== 'open') {
        episode.delivery = closedDelivery(gate)

        return
      }

      const sent = await callPhone('raise', episode.id, notification.priority, () =>
        notifier.send(notification),
      )

      if (sent.ok) {
        episode.delivery = 'sent'
        episode.receipt = sent.value.receipt
        episode.sentAt = now()
      } else {
        episode.delivery = 'unsent'
        episode.failures++
        retrySoon(episode)
      }
    })
  }

  function isCovered(id: AlertId) {
    const stronger = coveredBy[id]

    return stronger !== undefined && episodes.has(stronger)
  }

  function afterPreviousCalls<T>(episode: Episode, call: () => Promise<T>): Promise<T> {
    const result = episode.phoneCalls.then(call)
    episode.phoneCalls = result.catch(() => undefined)

    return result
  }

  /** A receipt past its expiry has stopped repeating on its own and cannot be cancelled. */
  async function cancelReceipt(episode: Episode): Promise<PhoneOutcome<void>> {
    const receipt = episode.receipt

    if (!notifier || receipt === null || receiptExpired(episode)) return { ok: true, value: undefined }

    const cancelled = await callPhone('cancel', episode.id, 2, () => notifier.cancel(receipt))

    if (cancelled.ok) episode.receipt = null

    return cancelled
  }

  /** Hands a receipt Pushover would not cancel to the stray list, which keeps trying. */
  async function cancelOrKeepTrying(episode: Episode) {
    const cancelled = await cancelReceipt(episode)

    if (!cancelled.ok && episode.receipt !== null && episode.sentAt !== null) {
      keepTryingToCancel({ receipt: episode.receipt, sentAt: episode.sentAt, reason: cancelled.reason, since: now() })
      episode.receipt = null
    }
  }

  /**
   * The phone is closed to this alert, because the switch went off or the sun came up: stop what is
   * repeating on the phone and what is still waiting to go out. An alert waiting for dark that is
   * switched off stays off, like every alert silenced by the switch.
   */
  async function holdBack(episode: Episode) {
    const gate = phoneGate()

    if (gate === 'open') return

    if (episode.delivery === 'sent' && episode.receipt !== null) {
      await cancelOrKeepTrying(episode)
      episode.delivery = closedDelivery(gate)
    } else if (episode.delivery === 'unsent' || episode.delivery === 'skipped' || episode.delivery === 'held') {
      stopRetrying(episode)
      episode.delivery = closedDelivery(gate)
    }
  }

  function closedDelivery(gate: Exclude<Gate, 'open'>) {
    return gate === 'off' ? 'muted' : 'held'
  }

  function phoneGate(): Gate {
    if (!phoneOn) return 'off'

    return sunNow() === 'light' ? 'not-dark' : 'open'
  }

  /** An unknown site fails open: a missed alert on an unattended rig costs more than an extra page. */
  function sunNow(): Sun {
    if (!site) return 'unknown'

    return sunAltitudeDegrees(site, new Date(now())) < astronomicalDarkDegrees ? 'dark' : 'light'
  }

  /**
   * Acts when the sun crosses the dark line. At dusk, or when the site turns out unknown, every alert
   * still standing that waited for dark is told to the phone, once. At dawn what repeats on the phone is cancelled and what waits is held for
   * the next dusk.
   */
  function syncSun() {
    const sun = sunNow()

    if (sun === sunSeen) return

    sunSeen = sun

    if (sun !== 'light') {
      for (const episode of episodes.values()) {
        if (episode.delivery !== 'held' || episode.acknowledged) continue

        episode.failures = 0
        episode.eligibleAt = now()
        announce(episode)
      }
    } else {
      for (const episode of episodes.values()) void afterPreviousCalls(episode, () => holdBack(episode))
    }
  }

  /** Dusk and dawn arrive with no poll or frame to notice them, such as while a failed run's alert stands. */
  function watchSun() {
    clearTimeout(sunTimer)

    if (closed || !site || !notifier) return

    const outlook = darkOutlook(site, new Date(now()))
    const change = outlook.dark ? outlook.until : outlook.from
    const wait = change ? change.getTime() - now() + sunTimerMarginMs : sunRecheckMs

    sunTimer = setTimeout(() => {
      syncSun()
      watchSun()
    }, Math.min(Math.max(wait, sunTimerMarginMs), sunRecheckMs))

    sunTimer.unref()
  }

  /** Reads where the rig is from its mount. A site that is known is read again when a run starts. A mount that cannot be reached leaves it as it was. */
  async function learnSite(startingRun = false) {
    if (!readSite || !notifier || closed || siteRead) return

    if (site && !startingRun) return

    const at = now()

    if (!site && !startingRun && siteTriedAt !== null && at - siteTriedAt < siteRetryMs) return

    siteTriedAt = at

    siteRead = (async () => {
      try {
        const read = await readSite(AbortSignal.timeout(mountReadTimeoutMs))

        if (closed) return

        // A mount that answers with no usable location drops the old site: the rig may have moved,
        // and daylight at the old place must not hold back a page.
        site = read
        syncSun()
        watchSun()
      } catch {
        // The mount is not answering. The site stays as it was, and the next try is soon.
      } finally {
        siteRead = null
      }
    })()

    await siteRead
  }

  function pagingWindow(): PagingWindow {
    if (!site) return { state: 'site-unknown' }

    const outlook = darkOutlook(site, new Date(now()))

    if (outlook.dark) return { state: 'astro-dark', until: outlook.until?.getTime() ?? null }

    return { state: 'not-dark', from: outlook.from?.getTime() ?? null, until: outlook.until?.getTime() ?? null }
  }

  /** The alert is gone from the banner, so nothing else would ever stop the phone repeating. */
  function keepTryingToCancel(stray: StrayReceipt) {
    strayReceipts.push(stray)
    retryStraysSoon()
  }

  function retryStraysSoon() {
    if (closed) return

    strayTimer ??= setTimeout(retryStrayReceipts, resendAfterFailureMs)
    strayTimer.unref()
  }

  /** A stray stays in the list, so the view keeps saying so, until its cancel succeeds or it expires. */
  async function retryStrayReceipts() {
    strayTimer = undefined

    for (const stray of strayReceipts.slice()) {
      const cancelled =
        notifier && !receiptExpired(stray)
          ? await callPhone('cancel', 'stray-receipt', 2, () => notifier.cancel(stray.receipt))
          : { ok: true as const, value: undefined }

      if (cancelled.ok) strayReceipts.splice(strayReceipts.indexOf(stray), 1)
      else stray.reason = cancelled.reason
    }

    if (strayReceipts.length > 0) retryStraysSoon()
  }

  function receiptExpired({ sentAt }: { sentAt: number | null }) {
    return sentAt !== null && now() - sentAt >= emergencyExpireSeconds * 1000
  }

  /** Every call to the phone leaves a span and updates what Vela says about phone alerts. */
  async function callPhone<T>(
    action: 'raise' | 'clear' | 'cancel' | 'test',
    alertId: AlertId | 'test' | 'stray-receipt',
    priority: number,
    call: () => Promise<T>,
  ): Promise<PhoneOutcome<T>> {
    const span = tracer.startSpan('alert.delivery', {
      attributes: {
        'alert.rig.id': rigId,
        'alert.id': alertId,
        'alert.delivery.action': action,
        'alert.delivery.priority': priority,
      },
    })

    try {
      const value = await call()

      span.setAttribute('alert.delivery.status', 'delivered')
      phone = { state: 'ready' }

      return { ok: true, value }
    } catch (error) {
      // Anything but a NotifierError is a bug, and its message could carry a key.
      const reason = error instanceof NotifierError ? error.reason : 'unexpected error'

      span.setAttribute('alert.delivery.status', 'failed')
      span.setAttribute('alert.delivery.reason', reason)
      span.setStatus({ code: SpanStatusCode.ERROR, message: reason })
      phone = { state: 'failing', reason, since: phone.state === 'failing' ? phone.since : now() }

      return { ok: false, reason }
    } finally {
      span.end()
    }
  }

  function deliveryOf(episode: Episode): AlertDelivery {
    if (!notifier) return { state: 'not-configured' }

    switch (episode.delivery) {
      case 'sent':
      case 'sending':
        return { state: episode.delivery }
      case 'skipped':
        return { state: 'covered' }
      case 'muted':
        return { state: 'muted' }
      case 'held':
        return { state: 'outside-dark' }
      case 'gave-up':
        return { state: 'gave-up', failures: episode.failures }
      case 'unsent':
        return episode.retry
          ? { state: 'retrying', failures: episode.failures, nextAttemptAt: episode.retry.at, giveUpAt: episode.eligibleAt + giveUpAfterMs }
          : { state: 'gave-up', failures: episode.failures }
    }
  }

  /** An emergency still repeating on the phone is a failure, however recent calls went. */
  function phoneWithStrays(): PhoneAlerts {
    const stray = strayReceipts[0]

    if (!stray) return phone

    return { state: 'failing', reason: `could not stop an emergency repeating: ${stray.reason}`, since: stray.since }
  }

  function title() {
    return `Vela: ${rigName}`
  }

  // -------------------------------------------------------------------------
  // The mount poll

  async function pollMount(token: number) {
    if (polling) return

    polling = true

    try {
      if (readMount) {
        try {
          const reading = await readMount(AbortSignal.timeout(mountReadTimeoutMs))

          if (token !== runToken) return

          if (reading) mountReadings.push(reading)

          observationsInterruptedSince = null
        } catch {
          if (token !== runToken) return

          observationsInterruptedSince ??= now()
        }
      }

      if (readFocuser) {
        try {
          const position = await readFocuser(AbortSignal.timeout(mountReadTimeoutMs))

          if (token !== runToken) return

          focuserMovedTo(position)
        } catch {
          if (token !== runToken) return
        }
      }

      evaluate()
    } finally {
      polling = false
    }
  }

  /**
   * Star counts rise as focus worsens and fall after a refocus, so a moved focuser, by hand or by
   * autofocus, starts the history over like autofocus ending does. A frame exposed across the
   * move, within one poll, lands in whichever history is current when it arrives.
   */
  function focuserMovedTo(position: number | null) {
    if (position === null) return

    if (focuserPosition !== null && position !== focuserPosition) frames = []

    focuserPosition = position
  }

  function startPolling() {
    const token = runToken

    void pollMount(token)
    pollTimer = setInterval(() => void pollMount(token), pollMs)
    pollTimer.unref()
  }

  function stopPolling() {
    clearInterval(pollTimer)
    pollTimer = undefined
  }

  // -------------------------------------------------------------------------

  return {
    runStarted(exposureSeconds: number) {
      stopPolling()
      runToken++
      autofocusing = false
      frames = []
      focuserPosition = null
      mountReadings = []
      observationsInterruptedSince = null
      run = { status: 'running', exposureSeconds, waitingForFrameSince: now() }
      evaluate()

      // Everything from the last run has cleared by now. A new run starts with no guard.
      clearedAt.clear()
      startPolling()
      void learnSite(true)
    },

    /** A frame arrived. One without star measurements still proves the camera is producing. */
    frameCaptured(image: Pick<CaptureImage, 'capturedAt' | 'statistics'>) {
      if (run.status !== 'running') return

      run = { ...run, waitingForFrameSince: now() }

      if (image.statistics) {
        frames.push({
          capturedAt: Date.parse(image.capturedAt),
          stars: image.statistics.detectedStars,
          hfrPixels: image.statistics.medianHfrPixels,
        })
      }

      evaluate()
    },

    runEnded(outcome: 'stopped' | 'failed') {
      stopPolling()
      runToken++
      run = { status: outcome }
      evaluate()
    },

    /** Frames do not arrive during autofocus, so a missing frame is not a stall. */
    autofocusStarted() {
      autofocusing = true
    },

    /** Autofocus changes the star shapes, so the baseline starts over. */
    autofocusEnded() {
      if (run.status !== 'running') return

      autofocusing = false
      frames = []
      run = { ...run, waitingForFrameSince: now() }
      evaluate()
    },

    view(): AlertsView {
      const alerts = [...episodes.values()]
        .filter(episode => !isCovered(episode.id))
        .sort((a, b) => levelRank(b.level) - levelRank(a.level) || a.raisedAt - b.raisedAt)
        .map(episode => {
          const { id, level, message, raisedAt, acknowledged } = episode

          return { id, level, message, raisedAt, acknowledged, delivery: deliveryOf(episode) }
        })

      return {
        rigId,
        watching: run.status === 'running',
        alerts,
        unavailable,
        phone: phoneWithStrays(),
        phoneAlertsOn: phoneOn,
        pagingWindow: pagingWindow(),
        thresholds,
      }
    },

    /** Acknowledged only once the phone has stopped repeating, so it is never claimed early. */
    async acknowledge(id: string): Promise<AcknowledgeResult> {
      const episode = [...episodes.values()].find(candidate => candidate.id === id)

      if (!episode) return { outcome: 'not-active' }

      return afterPreviousCalls(episode, async (): Promise<AcknowledgeResult> => {
        const cancelled = await cancelReceipt(episode)

        if (!cancelled.ok) return { outcome: 'phone-failed', reason: cancelled.reason }

        episode.acknowledged = true

        if (episode.delivery === 'unsent') {
          stopRetrying(episode)
          episode.delivery = 'gave-up'
        }

        return { outcome: 'acknowledged' }
      })
    },

    /**
     * Turning it off first stops every message from here on, then cancels the emergencies already
     * repeating. Turning it on again pages only alerts raised after that.
     */
    async setPhoneAlerts(on: boolean) {
      phoneOn = on

      if (on) return

      await Promise.all([...episodes.values()].map(episode => afterPreviousCalls(episode, () => holdBack(episode))))
    },

    /** Finds where the rig is, once, so the view can say when the phone is paged. Asks again soon if the mount is silent. */
    learnSite() {
      return learnSite()
    },

    async sendTest(): Promise<TestResult> {
      if (!notifier) return { outcome: 'not-configured' }

      if (!phoneOn) return { outcome: 'off' }

      // A test is Chris asking for a page, so it goes out in daylight too.
      const sent = await callPhone('test', 'test', 0, () =>
        notifier.send({ title: title(), message: 'test', priority: 0 }),
      )

      return sent.ok ? { outcome: 'delivered' } : { outcome: 'failed', reason: sent.reason }
    },

    /** Stops the mount poll and every retry. Nothing is evaluated or sent. */
    close() {
      closed = true
      stopPolling()
      clearTimeout(strayTimer)
      strayTimer = undefined
      clearTimeout(sunTimer)

      for (const episode of episodes.values()) stopRetrying(episode)

      runToken++
    },
  }
}

export type AlertMonitor = ReturnType<typeof createAlertMonitor>

function levelRank(level: AlertLevel) {
  return level === 'critical' ? 1 : 0
}
