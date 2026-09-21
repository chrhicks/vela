import type { TargetSkyPath } from '@vela/model/web'

export const skyTime = (at: string) =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

export function skyWindow(sky: TargetSkyPath) {
  return sky.aboveHorizonDuringDarkness.length
    ? sky.aboveHorizonDuringDarkness
      .map(w => `Approx. ${skyTime(w.startsAt)}–${skyTime(w.endsAt)}`)
      .join(' · ')
    : 'Not above horizon during darkness'
}
