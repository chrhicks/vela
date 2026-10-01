export function photographTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
}

export function photographDate(timestamp: string, year = true) {
  const date = new Date(timestamp)
  const month = date.toLocaleDateString('en-US', { month: 'short' })

  return `${date.getDate()} ${month}${year ? ` ${date.getFullYear()}` : ''}`
}

export function photographDay(timestamp: string) {
  return new Date(timestamp).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}
