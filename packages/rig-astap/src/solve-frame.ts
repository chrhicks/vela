import { readFile } from 'node:fs/promises'
import type { ImageId, SkyPosition, SolveBody } from '@vela/rig-events'
import { readFits } from './fits-read.ts'
import type { MonoFrame } from './frame.ts'
import { AstapTimeout, type AstapSolver } from './solver.ts'

export interface SolveRequest {
  readonly imageId: ImageId
  readonly hint: SkyPosition
  readonly solverVersion: string
}

type Failed = Extract<SolveBody, { readonly status: 'no-solution' }>

function failure(request: SolveRequest, solveMs: number, reason: Failed['reason'], radiusDegrees: number | null): SolveBody {
  return {
    status: 'no-solution',
    imageId: request.imageId,
    solverVersion: request.solverVersion,
    solveMs,
    hint: radiusDegrees === null ? null : { ...request.hint, radiusDegrees },
    reason,
  }
}

/**
 * Pixels in, one solve fact out. A frame that will not solve is a fact too, with its reason, so this never
 * throws for the frame's sake. Only a cancelled `signal` escapes, because a cancelled solve says nothing
 * about the frame.
 */
export async function solveFrame(solver: AstapSolver, request: SolveRequest, frame: MonoFrame, signal: AbortSignal): Promise<SolveBody> {
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)

  try {
    const result = await solver.solve(frame, request.hint, signal)

    if (result.status === 'no-solution') return failure(request, elapsed(), result.reason, result.radiusDegrees)

    return {
      status: 'solved',
      imageId: request.imageId,
      solverVersion: request.solverVersion,
      solveMs: elapsed(),
      hint: { ...request.hint, radiusDegrees: result.radiusDegrees },
      centre: result.centre,
      wcs: result.wcs,
    }
  } catch (error) {
    if (signal.aborted) throw error

    return error instanceof AstapTimeout ? failure(request, elapsed(), 'timeout', error.radiusDegrees) : failure(request, elapsed(), 'solver-error', null)
  }
}

export async function solveFile(solver: AstapSolver, request: SolveRequest, path: string, signal: AbortSignal): Promise<SolveBody> {
  const bytes = await readFile(path).then(
    content => content,
    () => undefined,
  )

  if (bytes === undefined) return failure(request, 0, 'image-missing', null)

  const read = readFits(bytes)

  return read.ok ? solveFrame(solver, request, read.frame, signal) : failure(request, 0, 'image-unreadable', null)
}
