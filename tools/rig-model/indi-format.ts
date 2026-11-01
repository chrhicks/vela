/** INDI's `%<width>.<fraction>m` prints sexagesimal; fraction 6 is whole seconds, 8 tenths, 9 hundredths. */
export function displayStep(format: string): number {
  const fraction = /^%\d*\.(\d)m$/.exec(format)?.[1]

  const steps = new Map([
    ['3', 1 / 60],
    ['5', 0.1 / 60],
    ['6', 1 / 3600],
    ['8', 0.1 / 3600],
    ['9', 0.01 / 3600],
  ])

  const step = steps.get(fraction ?? '')

  if (step === undefined) throw new Error(`Unknown INDI number format ${format}`)

  return step
}
