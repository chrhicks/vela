export type RunEventKind = 'started' | 'exposed' | 'failed' | 'ended'

export interface RunEvent {
  readonly kind: RunEventKind
  readonly run: string
  readonly body: Readonly<Record<string, unknown>>
}

export function runEntry(event: RunEvent, rig: string, at: number) {
  const detail = event.kind === 'exposed' ? `:${String(event.body['frame'])}` : event.kind === 'failed' ? `:${String(event.body['attempt'])}` : ''

  return { v: 2, id: `vela.run.${event.kind}:${event.run}${detail}`, rig, kind: `vela.run.${event.kind}`, at, source: 'vela', body: { run: event.run, ...event.body } }
}
