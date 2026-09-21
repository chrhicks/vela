/** Preview of the walk window around the current EAF position. 0 and MaxStep are stops, not homes. */
export function previewAutofocusWindow(
  position: number | null,
  stepSize: number,
  offsetSteps: number,
  maxStep: number | null,
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

  if (position < 1 || low < 1) return { fit: false }

  if (
    maxStep != null &&
    (!Number.isSafeInteger(maxStep) || position > maxStep - 1 || high > maxStep - 1)
  ) {
    return { fit: false }
  }

  return { fit: true, low, high }
}
