import type { AlertsView, AlertView } from '@vela/model/web'

export function clockTime(epochMs: number) {
  return new Date(epochMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function ageLabel(epochMs: number, now: number) {
  const minutes = Math.floor(Math.max(0, now - epochMs) / 60_000)

  if (minutes < 1) return 'just now'

  if (minutes < 60) return `${minutes} min ago`

  return `${Math.floor(minutes / 60)} h ${minutes % 60} min ago`
}

export function deliveryLabel(alert: AlertView) {
  const { delivery } = alert

  switch (delivery.state) {
    case 'sent':
      return alert.level === 'critical' && !alert.acknowledged
        ? 'Sent · repeating on your phone until acknowledged'
        : 'Sent to your phone'
    case 'sending':
      return 'Sending to your phone…'
    case 'covered':
      return 'Covered by a stronger alert'
    case 'not-configured':
      return 'Not sent · phone alerts are not set up'
    case 'retrying':
      return `Phone has not taken it (${delivery.failures}×) · trying again at ${clockTime(delivery.nextAttemptAt)}`
    case 'gave-up':
      return 'Not delivered to your phone · Vela stopped trying'
  }
}

/** The banner mentions the phone only when it is repeating or the alert is not getting through. */
export function bannerPhoneNote(alert: AlertView) {
  const { state } = alert.delivery
  const repeating = state === 'sent' && alert.level === 'critical' && !alert.acknowledged

  return repeating || state === 'retrying' || state === 'gave-up' ? deliveryLabel(alert) : null
}

export function phoneLabel(phone: AlertsView['phone']) {
  switch (phone.state) {
    case 'ready':
      return 'Phone alerts are ready'
    case 'not-configured':
      return 'Phone alerts are not set up · alerts show here only'
    case 'failing':
      return `Phone alerts failing: ${phone.reason} · since ${clockTime(phone.since)}`
  }
}

const thresholdLabels: [key: string, label: string, unit: string][] = [
  ['starsSmoothingFrames', 'Star count is the median of', 'frames'],
  ['starsDropFraction', 'Stars dropping (warn) when down by', 'of the recent peak'],
  ['starsDropWindowMinutes', 'Stars dropping window', 'min'],
  ['starsCollapsedRatio', 'Stars collapsed (critical) below', '× baseline'],
  ['starsRecoveredRatio', 'Stars dropping and collapsed clear at', '× baseline'],
  ['starsDecliningRatio', 'Stars declining below', '× the window before'],
  ['starsDecliningClearRatio', 'Stars declining clears at', '× the window before'],
  ['starsDecliningWindowMinutes', 'Stars declining window', 'min'],
  ['confirmFrames', 'Frames to confirm collapse or HFR', 'frames'],
  ['baselineFrames', 'Baseline from last', 'frames'],
  ['minBaselineFrames', 'Frames needed for a baseline', 'frames'],
  ['minBaselineStarsForRatios', 'Smallest baseline for ratios', 'stars'],
  ['minBaselineStarsForEmptyFrame', 'Smallest baseline for empty frame', 'stars'],
  ['hfrHighPixels', 'HFR high (warn) above', 'px'],
  ['hfrHighClearPixels', 'HFR high clears below', 'px'],
  ['hfrBadPixels', 'HFR bad (critical) above', 'px'],
  ['hfrBadClearPixels', 'HFR bad clears below', 'px'],
  ['trackingStoppedReadings', 'Readings to confirm tracking stopped', 'readings'],
  ['meridianTrackLimitHours', 'Mount stops past the meridian at', 'h'],
  ['meridianNearMinutes', 'Meridian near (warn) within', 'min'],
  ['meridianImminentMinutes', 'Meridian imminent (critical) within', 'min'],
  ['rigUnreachableSeconds', 'Rig unreachable after', 's'],
  ['framesStalledGraceSeconds', 'Frames stalled after exposure plus', 's'],
]

/** Known thresholds in reading order, then any the server adds, so none is hidden. */
export function thresholdRows(thresholds: AlertsView['thresholds']) {
  const known = new Set(thresholdLabels.map(([key]) => key))

  const rows = thresholdLabels.flatMap(([key, label, unit]) => {
    const value = thresholds[key]

    return value === undefined ? [] : [{ key, label, value: `${value} ${unit}` }]
  })

  const extras = Object.entries(thresholds).flatMap(([key, value]) =>
    known.has(key) ? [] : [{ key, label: key, value: String(value) }],
  )

  return [...rows, ...extras]
}
