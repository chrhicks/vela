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
  phoneAlertsOn: true,
  pagingWindow: { state: 'not-dark', from: 1_760_790_000_000, until: 1_760_822_000_000 },
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

  it('accepts every paging window and an alert held for darkness, and requires the window', () => {
    for (const pagingWindow of [
      { state: 'site-unknown' },
      { state: 'astro-dark', until: 1_760_822_000_000 },
      { state: 'astro-dark', until: null },
      { state: 'not-dark', from: null, until: null },
    ])
      expect(isAlertsView({ ...view, pagingWindow }, 'fra')).toBe(true)

    expect(isAlertsView({ ...view, alerts: [{ ...view.alerts[0], delivery: { state: 'outside-dark' } }] }, 'fra')).toBe(true)
    expect(isAlertsView({ ...view, alerts: [{ ...view.alerts[0], delivery: { state: 'stopped-at-dawn' } }] }, 'fra')).toBe(true)
    expect(isAlertsView({ ...view, pagingWindow: undefined }, 'fra')).toBe(false)
    expect(isAlertsView({ ...view, pagingWindow: { state: 'not-dark', from: 1 } }, 'fra')).toBe(false)
  })

  it('accepts a muted alert and requires the switch state', () => {
    expect(isAlertsView({ ...view, phoneAlertsOn: false, alerts: [{ ...view.alerts[0], delivery: { state: 'muted' } }] }, 'fra')).toBe(true)
    expect(isAlertsView({ ...view, phoneAlertsOn: undefined }, 'fra')).toBe(false)
  })
})
