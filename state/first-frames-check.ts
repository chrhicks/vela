import { Schema } from 'effect'
import { FilterAnswer } from './commands.ts'

export const FirstFramesLimits = Schema.Struct({
  skippedFrames: Schema.Int,
  checkedFrames: Schema.Int,
  focusRatio: Schema.Number,
  trailedElongation: Schema.Number,
})

export type FirstFramesLimits = typeof FirstFramesLimits.Type

export const Verdict = Schema.Literals(['ok', 'poor', 'not-judged'])

export type Verdict = typeof Verdict.Type

const reading = Schema.optionalKey(Schema.Number)

export const Check = Schema.Union([
  Schema.Struct({ check: Schema.Literal('stars'), verdict: Verdict, stars: reading }),
  Schema.Struct({ check: Schema.Literal('focus'), verdict: Verdict, hfdPixels: reading, focusedPixels: reading }),
  Schema.Struct({ check: Schema.Literal('trailing'), verdict: Verdict, elongation: reading }),
  Schema.Struct({ check: Schema.Literal('sky'), verdict: Verdict, sky: reading }),
  Schema.Struct({ check: Schema.Literal('filter'), verdict: Verdict, filter: Schema.optionalKey(FilterAnswer) }),
  Schema.Struct({ check: Schema.Literal('settings'), verdict: Verdict, asSet: Schema.optionalKey(Schema.Boolean) }),
  Schema.Struct({ check: Schema.Literal('guiding'), verdict: Verdict, activity: Schema.optionalKey(Schema.String), averagePixels: reading }),
])

export type Check = typeof Check.Type

export const FirstFramesVerdict = Schema.Literals(['passed', 'poor'])

export type FirstFramesVerdict = typeof FirstFramesVerdict.Type

export const CheckedFrames = Schema.Struct({ from: Schema.Int, to: Schema.Int })
