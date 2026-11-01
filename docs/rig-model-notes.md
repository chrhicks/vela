# Rig model notes

Open points that did not block a unit. Each one names the unit it came from.

## Deviations from the design contract

- **`cria.exchange` and `cria.image` are ignored by the model (unit 4).** The design had an exchange for a move command mark the mount as moving. A State snapshot already lists the mount's operations, running and settled, with exact start and settle times, so the operations carry the same fact and also catch a slew shorter than the one-second tick. The exchange would add a second source of the same motion and a way for the model to stay "moving" forever if the operation never appears. Reason to revisit: if Cria ever stops listing settled operations, motion from exchanges becomes the only trace of a slew shorter than a tick.
- **The model has no `assess(model, now)` (unit 4).** The contract's graft 4 puts staleness in explicit clock inputs, so a view that ages a belief by itself would be a second path to the same transition. `step` with a clock input is the only way time passes.
- **`freshness` is not branched on (unit 4).** A `qualified` snapshot and an `observed` one reduce the same way, because the track is a step function that never treats a sample as periodic. The field is kept on the body so a consumer can tell a live snapshot from a rebuilt one.
- **`permissionsFor` and the NATS control subjects are not written (unit 1).** Nothing before unit 9 consumes them, and their shape depends on the stream and durable names that unit chooses. `kinds[...].producers` already holds the data they derive from.
- **Event ids for content-keyed kinds use FNV-1a 64, not SHA-256 (unit 1).** `@vela/rig-events` has no `node:crypto`, and a 64-bit hash of a body that already shares a kind and a millisecond is enough to tell two facts apart. A collision would merge two facts that are identical in kind, time and 64 bits of content.
- **A solve fact carries more failure reasons than the sketch (unit 3).** `too-few-stars` and `solver-error` were added to `SolveBody`.
- **The pointing rejection reasons differ from the sketch (unit 4).** `slewing-during-exposure` became `mount-moved-during-exposure`, since any change beyond the display step counts, and `exposure-spans-epochs`, `mount-not-covered`, `solve-missing`, `frame-missing`, `bad-capture-time` and `offset-undefined` were added.
- **`pointing-fix` carries an `effect` (unit 4).** The contract says an older-epoch exposure is rejected. The fix is a real measurement of the mount's report in a stable stretch, so it is recorded with `history-only` and a reason. A slewing exposure has no usable mount position, so it is rejected outright.

## Contracts the sources must keep

- **`seenAt` of a frame or a solve is arrival on the Cria stream's clock (unit 7 must synthesize it).** The backfill stamps a solve with its frame's capture end plus solve time. A source stamped with the import time makes every pair look 120 s late and the model rejects it as `solve-missing`. A test pins this (`time.test.ts`, "takes seenAt as arrival"). Review round 2 asked for the model to accept such pairs as history; the model cannot tell an import clock from a late delivery, and round 1 needed the arrival times to decide expiry the same way with or without clock inputs.
- **Decisions are remembered until the next setup starts.** An image id and its decision time cost about 100 bytes, so a night is about a megabyte. A redelivery at any age is refused. Review round 3 showed that a bounded memory needs one age key shared by the frame and its solve, and a solve does not carry its frame's exposure end.

## Guesses to revisit with real nights (unit 5 onward)

- `knownMaxAgeMs` is 30 minutes. A solve every few minutes keeps a position known, and nothing else has measured how long a steady mount stays where a solve left it.
- `streamQuietMs` is 10 s, and `hiddenMoveArcmin` is 5. Both are set from the one-second snapshot tick and the AM5's 30 arcsecond display step. Real recordings may show guiding moves the reported position more than expected.
- A Cria restart resets the mount position to `unknown` whatever the first position after it is (Chris, 2026-10-31). A restart fails the run and returns everything to its default state: Cria stops a slew on shutdown and pending exposures end. This replaces the earlier rule that kept the last fix as `uncertain` when the position was unchanged and tracking was on.
- Only the first solve of an image counts. A second solve of the same image by another solver version is ignored.

## Not done yet

- The model has not seen a real night. Units 5 to 7 bring errai's recordings.
- `tangentOffsetArcmin` gives no answer past 89 degrees, and the model rejects such a fix as `offset-undefined`. A mount that points more than 89 degrees from the sky it reports would be a fault to surface, not only a rejected frame.

## Comment pass (Comment Sicko, Sonnet 5.5) flags left open

- `nextMount` trusts every `fix` input; eligibility lives in the reducer (`effectOf` in `join.ts`). A branded `EligibleFix` type would make that a compile-time fact. Not done: it would touch the state machine's table tests and the reducer for no behavior change.
- `skyAt` in `packages/rig-model/test/support.ts` returns of-date coordinates as a plain `SkyPosition`, which the type cannot tell from J2000. A test helper only.
