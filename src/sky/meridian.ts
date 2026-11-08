import { SiderealTime } from 'astronomy-engine'

const siderealSecondsPerSecond = 1.0027379093

export interface MeridianInput {
  readonly raHours: number
  readonly longitudeDegrees: number
  readonly limitDegrees: number
  readonly at: number
}

export function secondsToMeridianLimit({ raHours, longitudeDegrees, limitDegrees, at }: MeridianInput) {
  const localSiderealHours = SiderealTime(new Date(at)) + longitudeDegrees / 15
  const hourAngle = ((((localSiderealHours - raHours) % 24) + 36) % 24) - 12

  return ((limitDegrees / 15 - hourAngle) * 3600) / siderealSecondsPerSecond
}

function hours(value: number) {
  const whole = Math.floor(value)
  const minutes = Math.round((value - whole) * 60)

  return minutes === 60 ? { whole: whole + 1, minutes: 0 } : { whole, minutes }
}

export function formatDuration(seconds: number) {
  const { whole, minutes } = hours(Math.abs(seconds) / 3600)

  return whole === 0 ? `${minutes} min` : `${whole} h ${String(minutes).padStart(2, '0')} min`
}

export function meridianText(secondsLeft: number) {
  return secondsLeft >= 0 ? `in ${formatDuration(secondsLeft)}` : `reached, ${formatDuration(secondsLeft)} past`
}
