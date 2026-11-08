export interface NightNaming {
  readonly zone: string
  readonly changesAtHour: number
}

export function nightOf(at: number, naming: NightNaming) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: naming.zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' })
      .formatToParts(new Date(at))
      .map(part => [part.type, Number(part.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour', number>

  const evening = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - (parts.hour < naming.changesAtHour ? 1 : 0)))

  return evening.toISOString().slice(0, 10)
}

export const nightPattern = /^\d{4}-\d{2}-\d{2}$/
