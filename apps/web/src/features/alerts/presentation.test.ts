import { describe, expect, it } from 'vitest'
import type { AlertView } from '@vela/model/web'
import { ageLabel, bannerPhoneNote, deliveryLabel, phoneLabel, thresholdRows } from './presentation'

const critical: AlertView = {
  id: 'stars-collapsed',
  level: 'critical',
  message: 'Stars dropped from 1100 to 0',
  raisedAt: 0,
  acknowledged: false,
  delivery: { state: 'sent' },
}

describe('alert delivery wording', () => {
  it('says an unacknowledged emergency repeats, and stops saying so once acknowledged', () => {
    expect(deliveryLabel(critical)).toBe('Sent · repeating on your phone until acknowledged')
    expect(bannerPhoneNote(critical)).toBe('Sent · repeating on your phone until acknowledged')
    expect(deliveryLabel({ ...critical, acknowledged: true })).toBe('Sent to your phone')
    expect(bannerPhoneNote({ ...critical, acknowledged: true })).toBeNull()
  })

  it('shows the banner a phone problem but not routine delivery', () => {
    const warn: AlertView = { ...critical, level: 'warn' }

    expect(bannerPhoneNote(warn)).toBeNull()
    expect(bannerPhoneNote({ ...warn, delivery: { state: 'not-configured' } })).toBeNull()
    expect(bannerPhoneNote({ ...warn, delivery: { state: 'gave-up', failures: 3 } })).toBe(
      'Not delivered to your phone · Vela stopped trying',
    )
    expect(deliveryLabel({ ...warn, delivery: { state: 'retrying', failures: 2, nextAttemptAt: 0, giveUpAt: 1 } })).toMatch(
      /^Phone has not taken it \(2×\) · trying again at /,
    )
  })

  it('reports a failing phone with its reason', () => {
    expect(phoneLabel({ state: 'failing', reason: 'Pushover answered 500', since: 0 })).toMatch(
      /^Phone alerts failing: Pushover answered 500 · since /,
    )
    expect(phoneLabel({ state: 'not-configured' })).toBe('Phone alerts are not set up · alerts show here only')
  })
})

describe('alert time wording', () => {
  it('rounds down to minutes and hours', () => {
    expect(ageLabel(0, 59_000)).toBe('just now')
    expect(ageLabel(0, 120_000)).toBe('2 min ago')
    expect(ageLabel(0, 3_900_000)).toBe('1 h 5 min ago')
    expect(ageLabel(10_000, 0)).toBe('just now')
  })
})

describe('thresholds in use', () => {
  it('lists known thresholds with units and keeps unknown ones visible', () => {
    expect(thresholdRows({ hfrBadPixels: 6, futureRule: 3 })).toEqual([
      { key: 'hfrBadPixels', label: 'HFR bad (critical) above', value: '6 px' },
      { key: 'futureRule', label: 'futureRule', value: '3' },
    ])
  })
})
