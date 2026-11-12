import { numberOf, recordOf, textOf, type Entry } from './entry.ts'

interface RunFacts {
  readonly id: string
  readonly object: string
  readonly frameType: string
  readonly exposureSeconds: number
  readonly count: number
  readonly startedAt: number
  readonly frames: number
  readonly failures: number
}

export type Run =
  | (RunFacts & { readonly status: 'capturing' })
  | (RunFacts & { readonly status: 'ended'; readonly endedAt: number; readonly reason: string })

function started(entry: Entry): Run | undefined {
  const body = recordOf(entry.body)

  if (body === undefined) return undefined

  const id = textOf(body, 'run')
  const object = textOf(body, 'object')
  const frameType = textOf(body, 'frameType')
  const exposureSeconds = numberOf(body, 'exposureSeconds')
  const count = numberOf(body, 'count')

  if (id === undefined || object === undefined || frameType === undefined || exposureSeconds === undefined || count === undefined) return undefined

  return { status: 'capturing', id, object, frameType, exposureSeconds, count, startedAt: entry.at, frames: 0, failures: 0 }
}

function followUp(state: Run, entry: Entry): Run {
  const body = recordOf(entry.body)

  if (state.status !== 'capturing' || body === undefined || textOf(body, 'run') !== state.id) return state

  switch (entry.kind) {
    case 'vela.run.exposed':
      return { ...state, frames: numberOf(body, 'frame') ?? state.frames + 1 }
    case 'vela.run.failed':
      return { ...state, failures: state.failures + 1 }
    case 'vela.run.ended':
      return { ...state, status: 'ended', endedAt: entry.at, reason: textOf(body, 'reason') ?? 'unknown' }
    default:
      return state
  }
}

export function run(state: Run | undefined, entry: Entry): Run | undefined {
  if (entry.kind === 'vela.run.started') return started(entry) ?? state
  if (state === undefined) return state

  return followUp(state, entry)
}
