/** Preview of the walk window around the current EAF position. A reported MinStep makes the travel inclusive; without one the walk keeps the legacy one-step margin and never uses 0. */
export function previewAutofocusWindow(
  position: number | null,
  stepSize: number,
  offsetSteps: number,
  maxStep: number | null,
  minStep?: number | null,
): { fit: true; low: number; high: number } | { fit: false } {
  if (
    position == null ||
    !Number.isSafeInteger(position) ||
    !Number.isSafeInteger(stepSize) ||
    !Number.isSafeInteger(offsetSteps)
  ) {
    return { fit: false }
  }

  if (stepSize < 1 || offsetSteps < 1) return { fit: false }
  const low = position - offsetSteps * stepSize
  const high = position + offsetSteps * stepSize

  if (maxStep != null && !Number.isSafeInteger(maxStep)) return { fit: false }

  const reported = minStep != null
  const lowest = reported ? Math.max(minStep, 1) : 1
  const highest = maxStep == null ? Infinity : reported ? maxStep : maxStep - 1

  if (position < lowest || low < lowest || position > highest || high > highest) return { fit: false }

  return { fit: true, low, high }
}
