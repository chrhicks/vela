export function TonightSteps({
  rigReady,
  targetName,
}: {
  rigReady: boolean
  targetName: string | null
}) {
  const steps = [
    { name: 'Rig', done: rigReady, detail: rigReady ? 'Ready' : 'Needs attention' },
    { name: 'Target', done: targetName !== null, detail: targetName ?? 'Choose' },
    { name: 'Capture', done: false, detail: rigReady && targetName !== null ? 'Now' : 'Then expose' },
  ]

  const current = steps.findIndex(step => !step.done)

  return (
    <ol className="tonight-steps" aria-label="Tonight’s steps">
      {steps.map((step, index) => {
        const state = step.done ? 'done' : index === current ? 'current' : 'upcoming'

        return (
          <li key={step.name} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="tonight-steps__marker" aria-hidden="true">
              {step.done ? (
                <svg viewBox="0 0 14 14">
                  <path d="M3 7.5l3 3 5-6" />
                </svg>
              ) : (
                index + 1
              )}
            </span>
            <strong>{step.name}</strong>
            <span>{step.detail}</span>
          </li>
        )
      })}
    </ol>
  )
}
