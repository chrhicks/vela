export interface WorkingIndicatorProps {
  /** Inactive indicators retain their space without announcing ongoing work. */
  active: boolean
}

export function WorkingIndicator({ active }: WorkingIndicatorProps) {
  return (
    <div className="vela-working-indicator" data-working={active} aria-hidden={!active}>
      <span>Working</span>
      <span className="vela-working-indicator__shimmer" aria-hidden="true" />
    </div>
  )
}
