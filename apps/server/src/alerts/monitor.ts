import { trace, SpanStatusCode } from '@opentelemetry/api'
import type { CaptureImage } from '@vela/model/web'
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

/** How long before an alert that never reached the phone is sent again. */
const resendAfterFailureMs = 60_000

const mountPollMs = 10_000

const mountReadTimeoutMs = 5_000

/**
 * A weaker alert that a stronger one already covers is hidden from the banner and kept
 * off the phone while the stronger one stands. Both still run their own episodes.
 */
const coveredBy: Partial<Record<AlertId, AlertId>> = {
  'stars-low': 'stars-collapsed',
  'stars-declining': 'stars-collapsed',
  'hfr-high': 'hfr-bad',
  'meridian-near': 'meridian-imminent',
}

export interface ActiveAlert {
  id: AlertId
  level: AlertLevel
  message: string
  raisedAt: number
  /** Stops the phone repeating. The alert stays visible until its condition clears. */
  acknowledged: boolean
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
  alerts: ActiveAlert[]
  /** Watches that cannot run right now, such as "meridian watch unavailable: pier side". */
  unavailable: string[]
  phone: PhoneAlerts
  thresholds: AlertThresholds
}

export type AcknowledgeResult =
  | { outcome: 'acknowledged' }
  | { outcome: 'not-active' }
  | { outcome: 'phone-failed'; reason: string }

export type TestResult =
  | { outcome: 'delivered' }
  | { outcome: 'not-configured' }
  | { outcome: 'failed'; reason: string }

export interface AlertMonitorOptions {
  rigId: string
  rigName: string
  thresholds: AlertThresholds
  notifier: Notifier | null
  /**
   * A failed read means the rig stopped answering. Null means this rig has no mount to read,
   * so the mount watches report themselves unavailable instead.
   */
  readMount?: (signal: AbortSignal) => Promise<MountReading | null>
  now?: () => number
  mountPollMs?: number
}

/** One raised alert, from the evaluation that raised it until the one that clears it. */
interface Episode extends ActiveAlert {
  /** Unsent is retried after a failure. Skipped was covered by a stronger alert. */
  delivery: 'unsent' | 'sending' | 'sent' | 'skipped'
  /** The open emergency receipt, until it is cancelled. */
  receipt: string | null
  lastSendAttemptAt: number | null
  /** Keeps this episode's phone calls in order: raise, then acknowledge, then clear. */
  phoneCalls: Promise<unknown>
}

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
  readMount,
  now = Date.now,
  mountPollMs: pollMs = mountPollMs,
}: AlertMonitorOptions) {
  let run: RunState = { status: 'stopped' }
  let runToken = 0
  let autofocusing = false
  let frames: Frame[] = []
  let mountReadings: MountReading[] = []
  let observationsInterruptedSince: number | null = null
  let unavailable: string[] = []
  let phone: PhoneAlerts = notifier ? { state: 'ready' } : { state: 'not-configured' }
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let polling = false

  const episodes = new Map<AlertId, Episode>()
  const clearedAt = new Map<AlertId, number>()

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
  }

  function reconcile(conditions: AlertCondition[], at: number) {
    const current = new Map(conditions.map(condition => [condition.id, condition]))

    for (const episode of [...episodes.values()]) {
      const condition = current.get(episode.id)

      if (condition) episode.message = condition.message
      else clear(episode, at)
    }

    const raised = conditions.flatMap(condition => (episodes.has(condition.id) ? [] : raise(condition, at)))

    for (const episode of raised) announce(episode)

    resendUnsent(at)
  }

  function raise(condition: AlertCondition, at: number): Episode[] {
    const cleared = clearedAt.get(condition.id)

    if (cleared !== undefined && at - cleared < reRaiseGuardMs) return []

    const episode: Episode = {
      ...condition,
      raisedAt: at,
      acknowledged: false,
      delivery: 'unsent',
      receipt: null,
      lastSendAttemptAt: null,
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
    if (isCovered(episode.id)) episode.delivery = 'skipped'
    else sendRaised(episode)
  }

  function clear(episode: Episode, at: number) {
    episodes.delete(episode.id)
    clearedAt.set(episode.id, at)

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

      await cancelReceipt(episode)

      await callPhone('clear', episode.id, -1, () =>
        notifier.send({ title: title(), message: `cleared: ${episode.message}`, priority: -1 }),
      )
    })
  }

  /** An alert that failed to reach the phone is tried again, paced, until it does or clears. */
  function resendUnsent(at: number) {
    for (const episode of episodes.values()) {
      const waited = at - (episode.lastSendAttemptAt ?? at)

      if (episode.delivery === 'unsent' && !episode.acknowledged && waited >= resendAfterFailureMs)
        sendRaised(episode)
    }
  }

  function sendRaised(episode: Episode) {
    if (!notifier) return

    episode.delivery = 'sending'
    episode.lastSendAttemptAt = now()

    const notification: Notification = {
      title: title(),
      message: episode.message,
      priority: episode.level === 'critical' ? 2 : 0,
    }

    afterPreviousCalls(episode, async () => {
      const sent = await callPhone('raise', episode.id, notification.priority, () =>
        notifier.send(notification),
      )

      episode.delivery = sent.ok ? 'sent' : 'unsent'

      if (sent.ok) episode.receipt = sent.value.receipt
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
    const expired = now() - episode.raisedAt >= emergencyExpireSeconds * 1000

    if (!notifier || receipt === null || expired) return { ok: true, value: undefined }

    const cancelled = await callPhone('cancel', episode.id, 2, () => notifier.cancel(receipt))

    if (cancelled.ok) episode.receipt = null

    return cancelled
  }

  /** Every call to the phone leaves a span and updates what Vela says about phone alerts. */
  async function callPhone<T>(
    action: 'raise' | 'clear' | 'cancel' | 'test',
    alertId: AlertId | 'test',
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

      evaluate()
    } finally {
      polling = false
    }
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
      mountReadings = []
      observationsInterruptedSince = null
      run = { status: 'running', exposureSeconds, waitingForFrameSince: now() }
      evaluate()

      // Everything from the last run has cleared by now. A new run starts with no guard.
      clearedAt.clear()
      startPolling()
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
        .map(({ id, level, message, raisedAt, acknowledged }) => ({ id, level, message, raisedAt, acknowledged }))

      return {
        rigId,
        watching: run.status === 'running',
        alerts,
        unavailable,
        phone,
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

        return { outcome: 'acknowledged' }
      })
    },

    async sendTest(): Promise<TestResult> {
      if (!notifier) return { outcome: 'not-configured' }

      const sent = await callPhone('test', 'test', 0, () =>
        notifier.send({ title: title(), message: 'test', priority: 0 }),
      )

      return sent.ok ? { outcome: 'delivered' } : { outcome: 'failed', reason: sent.reason }
    },

    /** Stops the mount poll. Nothing is evaluated or sent. */
    close() {
      stopPolling()
      runToken++
    },
  }
}

export type AlertMonitor = ReturnType<typeof createAlertMonitor>

function levelRank(level: AlertLevel) {
  return level === 'critical' ? 1 : 0
}
