import type { Run } from '../../../state/run.ts'
import type { Link } from './store.ts'

export type LinkProblem = { readonly _tag: 'NoConnection'; readonly since: number } | { readonly _tag: 'RigSilent'; readonly since: number }

export function linkProblem(link: Link, run: Run | undefined, heardAt: number | undefined, localNow: number): LinkProblem | undefined {
  const lastHeardLocally = link.beat?.receivedAt ?? link.openedAt
  const quietSeconds = (localNow - lastHeardLocally) / 1000

  if (link.status === 'lost' || (link.limits !== undefined && quietSeconds > link.limits.lostAfterSeconds)) return { _tag: 'NoConnection', since: lastHeardLocally }
  if (link.beat === undefined || link.limits === undefined || heardAt === undefined || run?.status !== 'capturing') return undefined

  const serviceNow = link.beat.at + (localNow - link.beat.receivedAt)
  const silentSeconds = (serviceNow - heardAt) / 1000

  return silentSeconds > link.limits.rigSilentAfterSeconds ? { _tag: 'RigSilent', since: heardAt } : undefined
}
