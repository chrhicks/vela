import type { AcceptedFix } from '../equipment/composition.js'
import { trace, SpanStatusCode } from '@opentelemetry/api'
import {
  createAstapSolver,
  judgeSolve,
  type AstapConfig,
  type AstapSolver,
  type PlateWcs,
  type Purpose,
  type Reason,
  type Measured,
} from '@vela/rig-astap'
import type { SkyPosition } from '@vela/rig-events'
import type { ImageColor } from '../imaging/preview.js'

export type { PlateWcs, SkyPosition }

export interface MonoFrame {
  width: number
  height: number
  pixels: ArrayLike<number>
  capturedAt: string
  capturedAtSource?: 'camera' | 'server-estimate'
  color?: ImageColor
}

/**
 * A solve that failed the verdict is a `no-solution` with the verdict's reasons, never a position. `offHintDegrees` is
 * how far the rejected solution lay from where the mount claims to point.
 */
export type SolveResult =
  | { status: 'no-solution'; reasons: readonly Reason[]; measured?: Measured | null; offHintDegrees?: number }
  | ({ status: 'solved'; capturedAt: string; wcs: PlateWcs; error?: AcceptedFix['error'] } & SkyPosition)

export interface PlateSolver {
  /** `hint` is where ASTAP starts searching. `claimed` is where the mount says it points, which the verdict checks the solution against. */
  solve(frame: MonoFrame, hint: SkyPosition, claimed: SkyPosition, signal: AbortSignal): Promise<SolveResult>
}

const reasonWords: Record<Reason, string> = {
  'no-match': 'no star pattern matched',
  'few-stars': 'too few stars',
  scale: 'the plate scale does not match the optics',
  parity: 'the image is mirrored',
  'off-hint': 'the field is far from where the mount points',
}

export function describeRejection(result: Extract<SolveResult, { status: 'no-solution' }>): string {
  return result.reasons
    .map(reason =>
      reason === 'off-hint' && result.offHintDegrees !== undefined
        ? `the field is ${result.offHintDegrees.toFixed(1)} degrees from where the mount points`
        : reasonWords[reason],
    )
    .join('; ')
}

export function createPlateSolver(config: AstapConfig, purpose: Purpose): PlateSolver {
  return judgedSolver(createAstapSolver(config), config.fieldHeightDegrees, purpose)
}

/**
 * ASTAP's solution, kept only when `judgeSolve` accepts it for `purpose`. The expected scale comes from the field
 * height the caller already gave ASTAP, which the rig's focal length and the camera's pixels fix. The camera path
 * never mirrors, and every one of the 915 good frames of the audit corpus has a positive CD determinant.
 */
export function judgedSolver(astap: AstapSolver, fieldHeightDegrees: number, purpose: Purpose): PlateSolver {
  return {
    solve: (frame, hint, claimed, signal) =>
      trace.getTracer('vela.plate-solving').startActiveSpan(
        'astap.solve',
        {
          attributes: {
            'astap.purpose': purpose,
            'astap.hint.ra_degrees': hint.raDegrees,
            'astap.hint.dec_degrees': hint.decDegrees,
            'astap.field_height_degrees': fieldHeightDegrees,
            'image.width': frame.width,
            'image.height': frame.height,
            'image.captured_at': frame.capturedAt,
          },
        },
        async (span): Promise<SolveResult> => {
          try {
            // ASTAP does not read the exposure time to solve.
            const solution = await astap.solve(
              { ...frame, capturedAtSource: frame.capturedAtSource ?? 'camera', exposureSeconds: 0, color: frame.color ?? { kind: 'mono' } },
              hint,
              signal,
            )

            const verdict = judgeSolve(
              { solution, stars: null, claimed },
              { arcsecPerPixel: (fieldHeightDegrees * 3600) / frame.height, parity: 1 },
              purpose,
            )

            span.setAttribute('astap.outcome', verdict.status === 'accepted' ? 'solved' : 'rejected')

            if (verdict.status === 'rejected') {
              span.setAttribute('astap.rejected.reasons', verdict.reasons.join(','))

              const rejected: SolveResult = { status: 'no-solution', reasons: verdict.reasons, measured: verdict.measured }
              const offHintDegrees = verdict.measured?.hintOffsetDegrees

              if (verdict.reasons.includes('off-hint') && offHintDegrees != null) rejected.offHintDegrees = offHintDegrees

              return rejected
            }

            if (solution.status !== 'solved') throw new Error('An accepted verdict needs a solved outcome')

            return { status: 'solved', capturedAt: frame.capturedAt, wcs: solution.wcs, error: { scaleError: verdict.measured.scaleError, hintOffsetDegrees: verdict.measured.hintOffsetDegrees }, ...solution.centre }
          } catch (error) {
            span.setAttribute('astap.outcome', signal.aborted ? 'cancelled' : 'error')

            if (signal.aborted) span.setAttribute('operation.cancelled', true)
            else {
              span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : 'ASTAP failed' })

              if (error instanceof Error) span.recordException(error)
            }

            throw error
          } finally {
            span.end()
          }
        },
      ),
  }
}

export function reportAcceptedFix(solver: PlateSolver, send: (fix: AcceptedFix) => Promise<void>): PlateSolver {
  return {
    async solve(frame, hint, claimed, signal) {
      const result = await solver.solve(frame, hint, claimed, signal)

      if (result.status === 'solved' && result.error) await send({
        capturedAt: Date.parse(result.capturedAt),
        rightAscensionDegrees: result.raDegrees,
        declinationDegrees: result.decDegrees,
        coordinateSystem: 'j2000',
        error: result.error,
      })

      return result
    },
  }
}
