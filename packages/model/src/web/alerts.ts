export type AlertLevel = 'warn' | 'critical'

/** How the phone is getting on with one alert. */
export type AlertDelivery =
  | { state: 'sent' | 'sending' | 'covered' | 'not-configured' | 'muted' | 'outside-dark' }
  | { state: 'retrying'; failures: number; nextAttemptAt: number; giveUpAt: number }
  | { state: 'gave-up'; failures: number }

export interface AlertView {
  id: string
  level: AlertLevel
  message: string
  /** Epoch milliseconds. */
  raisedAt: number
  /** The phone has stopped repeating. The alert stays until its condition clears. */
  acknowledged: boolean
  delivery: AlertDelivery
}

export type PhoneAlertsView =
  | { state: 'not-configured' }
  | { state: 'ready' }
  | { state: 'failing'; reason: string; since: number }

/**
 * When the phone is paged for this rig: only while the sun is below -18 degrees at the rig's site.
 * Times are epoch milliseconds; null means the sun does not cross that line within two days.
 */
export type PagingWindow =
  /** The mount gave no location, so alerts page at any hour. */
  | { state: 'site-unknown' }
  | { state: 'astro-dark'; until: number | null }
  | { state: 'not-dark'; from: number | null; until: number | null }

/** The server's watch on one rig: what is wrong now, what cannot be watched, and the phone. */
export interface AlertsView {
  rigId: string
  /** False means no capture run is being checked, so an empty list is not a clean bill of health. */
  watching: boolean
  /** Critical first, then oldest first. */
  alerts: AlertView[]
  /** Watches that cannot run, such as "meridian watch unavailable: pier side". */
  unavailable: string[]
  phone: PhoneAlertsView
  /** Chris's switch for this rig. Off means Vela sends nothing to the phone; alerts still show here. */
  phoneAlertsOn: boolean
  /** When the switch, if on, actually pages. Alerts raised outside it show here with delivery `outside-dark`. */
  pagingWindow: PagingWindow
  /** Every number the rules use, by name. */
  thresholds: Readonly<Record<string, number>>
}
