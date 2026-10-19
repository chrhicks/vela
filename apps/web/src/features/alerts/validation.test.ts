import { describe, expect, it } from 'vitest'
import type { AlertsView } from '@vela/model/web'
import { isAlertsView } from './validation'

const view: AlertsView = {
  rigId: 'fra',
  watching: true,
  alerts: [
    {
      id: 'stars-collapsed',
      level: 'critical',
      message: 'Stars dropped from 1100 to 0',
      raisedAt: 1_760_758_337_000,
      acknowledged: false,
      delivery: { state: 'retrying', failures: 2, nextAttemptAt: 1_760_758_457_000, giveUpAt: 1_760_761_937_000 },
    },
  ],
  unavailable: ['meridian watch unavailable: pier side'],
  phone: { state: 'failing', reason: 'Pushover answered 500', since: 1_760_758_340_000 },
  thresholds: { hfrBadPixels: 6 },
}

describe('alerts boundary', () => {
  it('accepts the server projection', () => {
    expect(isAlertsView(view, 'fra')).toBe(true)
  })

  it('rejects another rig, an unknown level or delivery state, and a failing phone with no reason', () => {
    expect(isAlertsView(view, 'other')).toBe(false)
    expect(isAlertsView({ ...view, alerts: [{ ...view.alerts[0], level: 'info' }] }, 'fra')).toBe(false)
    expect(isAlertsView({ ...view, alerts: [{ ...view.alerts[0], delivery: { state: 'lost' } }] }, 'fra')).toBe(false)
    expect(isAlertsView({ ...view, phone: { state: 'failing', since: 1 } }, 'fra')).toBe(false)
  })
})
