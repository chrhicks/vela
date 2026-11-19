import { Schema } from 'effect'
import { described } from '../config.ts'

export const ReviewEffort = Schema.Literals(['low', 'medium', 'high', 'xhigh', 'max'])

export const ReviewSettings = Schema.Struct({
  enabled: described('Whether Vela asks the models below to look at a light frame when its stats get worse. Needs a sign-in from `ant auth login`; without one each answer records that', Schema.Boolean, true),
  models: described('The models asked, all with the same request at the same time, so their answers can be compared', Schema.Array(Schema.NonEmptyString), ['claude-opus-5-5', 'claude-haiku-5-5']),
  answersFile: described('The JSON-lines file every ask and every answer is appended to, kept past the stream\'s 7 days', Schema.String, '/mnt/storage/vela/review.jsonl'),
  baselineFrames: described('Good frames at the start of a light run whose median HFD and star count are the baseline later frames are compared with', Schema.Int.check(Schema.isGreaterThan(0)), 5),
  hfdRise: described('How much larger than the baseline HFD a frame\'s HFD must be to be asked about, as a fraction', Schema.Number, 0.2),
  starsDrop: described('How much smaller than the baseline star count a frame\'s star count must be to be asked about, as a fraction', Schema.Number, 0.25),
  elongation: described('The star elongation, long side over short side, above which a frame is asked about; frames above it are also left out of the baseline', Schema.Number, 1.3),
  guideLostBurst: described('PHD2 StarLost events since the previous frame\'s stats from which a frame is asked about', Schema.Int.check(Schema.isGreaterThan(0)), 3),
  cooldownFrames: described('Frames after an ask before the next ask, unless the frame is worse again', Schema.Int, 10),
  worseAgain: described('During the cooldown, how much further past the frame last asked about the HFD must rise or the star count fall, as a fraction, for another ask', Schema.Number, 0.15),
  trendFrames: described('The most recent frames whose stats are sent with an ask', Schema.Int.check(Schema.isGreaterThan(0)), 20),
  eventsSent: described('The most recent PHD2 StarLost and settle failure events sent with an ask', Schema.Int, 30),
  imageLongSide: described('The longest side, in pixels, of each picture sent with an ask', Schema.Int.check(Schema.isGreaterThan(0)), 1568),
  imageMaxBytes: described('The most bytes one picture sent with an ask may have; a larger one is made smaller until it fits', Schema.Int.check(Schema.isGreaterThan(0)), 4_500_000),
  effort: described('How much thinking effort the models are asked to put in', ReviewEffort, 'high'),
  maxTokens: described('The most tokens one answer, thinking included, may use', Schema.Int.check(Schema.isGreaterThan(0)), 16000),
})

export type ReviewSettings = typeof ReviewSettings.Type
