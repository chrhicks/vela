export function photographTime(timestamp: string, timeZone?: string) {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
}

export function photographDate(timestamp: string, year = true, timeZone?: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, day: 'numeric', month: 'short', year: 'numeric',
  }).formatToParts(new Date(timestamp))

  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value

  return `${value('day')} ${value('month')}${year ? ` ${value('year')}` : ''}`
}

export function photographDay(timestamp: string, timeZone?: string) {
  return new Date(timestamp).toLocaleDateString('en-GB', {
    timeZone, day: 'numeric', month: 'long', year: 'numeric',
  })
}
