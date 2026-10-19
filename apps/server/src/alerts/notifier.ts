/** -1 is quiet, 0 is normal, 2 repeats on the phone until it is acknowledged or expires. */
export type NotificationPriority = -1 | 0 | 2

/** A priority 2 message repeats every 60 s for up to an hour, or until it is cancelled. */
export const emergencyRetrySeconds = 60

export const emergencyExpireSeconds = 3600

export interface Notification {
  title: string
  message: string
  priority: NotificationPriority
}

/** `reason` is safe to show Chris and never contains a key. */
export class NotifierError extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'NotifierError'
  }
}

/** How an alert reaches the phone. Every failure is a `NotifierError`. */
export interface Notifier {
  /** `receipt` is set for priority 2 only: the handle that stops its repeats. */
  send(notification: Notification): Promise<{ receipt: string | null }>
  cancel(receipt: string): Promise<void>
}
