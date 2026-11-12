const niceSteps = [1, 2, 5, 10]

const decimalsOf = (step: number) => Math.max(0, -Math.floor(Math.log10(step)))

export function niceTicks(values: ReadonlyArray<number>): ReadonlyArray<number> {
  if (values.length === 0) return []

  const low = values.reduce((least, value) => Math.min(least, value))
  const high = values.reduce((most, value) => Math.max(most, value))
  const wanted = (high - low || Math.abs(high) || 1) / 2
  const power = 10 ** Math.floor(Math.log10(wanted))
  const step = (niceSteps.find(nice => nice * power >= wanted) ?? 10) * power
  const first = Math.floor(low / step)
  const last = Math.max(Math.ceil(high / step), first + 1)

  return Array.from({ length: last - first + 1 }, (_, index) => Number(((first + index) * step).toFixed(decimalsOf(step))))
}
