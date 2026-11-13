interface Plan {
  readonly now: string
  readonly dawn: string
  readonly targetUntil: string
  readonly exposureSeconds: number
  readonly frames: number | undefined
}

const minutesOf = (clock: string) => {
  const [hours = 0, minutes = 0] = clock.split(':').map(Number)

  return hours * 60 + minutes
}

const clockOf = (minutes: number) => {
  const inDay = ((Math.round(minutes) % 1440) + 1440) % 1440

  return `${String(Math.floor(inDay / 60)).padStart(2, '0')}:${String(inDay % 60).padStart(2, '0')}`
}

const afterNow = (clock: string, now: string) => (minutesOf(clock) - minutesOf(now) + 1440) % 1440

export function endsBy({ now, dawn, targetUntil, exposureSeconds, frames }: Plan): string {
  if (frames !== undefined) return clockOf(minutesOf(now) + (frames * exposureSeconds) / 60)

  return afterNow(targetUntil, now) <= afterNow(dawn, now) ? `${targetUntil}, TARGET LOW` : `${dawn}, DAWN`
}
