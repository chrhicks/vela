import type { RigEntry, RunEnding, RunId } from './entries.ts'

interface RunFacts {
  readonly id: RunId
  readonly object: string
  readonly frameType: string
  readonly exposureSeconds: number
  readonly count: number | undefined
  readonly startedAt: number
  readonly frames: number
  readonly failures: number
}

export type Run =
  | (RunFacts & { readonly status: 'capturing' })
  | (RunFacts & { readonly status: 'ended'; readonly endedAt: number; readonly reason: RunEnding })

export function run(state: Run | undefined, entry: RigEntry): Run | undefined {
  if (entry.kind === 'vela.run.started') {
    const { run: id, object, frameType, exposureSeconds, count } = entry.body

    return { status: 'capturing', id, object, frameType, exposureSeconds, count, startedAt: entry.at, frames: 0, failures: 0 }
  }

  if (state?.status !== 'capturing') return state

  switch (entry.kind) {
    case 'vela.run.exposed':
      return entry.body.run === state.id ? { ...state, frames: entry.body.frame } : state
    case 'vela.run.failed':
      return entry.body.run === state.id ? { ...state, failures: state.failures + 1 } : state
    case 'vela.run.ended':
      return entry.body.run === state.id ? { ...state, status: 'ended', endedAt: entry.at, reason: entry.body.reason } : state
    default:
      return state
  }
}
