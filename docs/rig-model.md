# Rig model

A read-only live model of the astrophotography rig, fed by a local NATS JetStream broker. Chris decided on 2026-10-31 that it lives in this repository as companion packages rather than in its own repo. Units 0 to 4 and 6 of its design are here; the design itself is kept in Chris's private notes. Nothing in this model sends a command to the rig, and the Vela server does not depend on it yet.

| Package | Directory | What it holds |
| --- | --- | --- |
| `@vela/rig-events` | `packages/rig-events` | the event registry, envelope, bodies, codec and the importer for Vela's Cria journals |
| `@vela/rig-sky` | `packages/rig-sky` | Vela's coordinate maths (a copy, see below) and the tangent-plane offset |
| `@vela/rig-astap` | `packages/rig-astap` | a saved-FITS reader, an ASTAP solver and `solveFrame` |
| `@vela/rig-frames` | `packages/rig-frames` | readers for Vela's saved images, frame records and alignment trials, and their join on `image.id` |
| `@vela/rig-model` | `packages/rig-model` | the pure reducer |
| `@vela/rig-testing` | `packages/rig-testing` | a synthetic site and State builders, for tests only |

Its commands (`pnpm check` and the journal and trial checks) are in [tools/rig-model/README.md](../tools/rig-model/README.md). Open points and deviations from the design are in [rig-model-notes.md](./rig-model-notes.md).

`packages/rig-sky/src/coordinates.ts` is a copy of `apps/server/src/astronomy/coordinates.ts`, and `packages/rig-sky/test/parity.test.ts` compares the two on 1,000 seeded random cases. A later change replaces the copy with one shared package.

## Cria wire pin

`@cria/wire` and `@cria/primitives` come from the one Cria pin in `pnpm-workspace.yaml`, shared with `@vela/cria`.

## Import rules

| Package | May import | May not import |
| --- | --- | --- |
| `@vela/rig-events` | `effect`, `@cria/wire` through `src/wire.ts` only | `node:*`, `nats`, any other `@vela/rig-*` |
| `@vela/rig-sky` | `astronomy-engine` | `node:*`, `effect`, `nats`, any other `@vela/rig-*` |
| `@vela/rig-model` | `@vela/rig-events`, `@vela/rig-sky` | `node:*`, `effect`, `nats`, `@cria/*`, `fetch`, `Date.now`, `Math.random` |
| `@vela/rig-astap` | `node:*`, `@vela/rig-events`, `@vela/rig-sky` | `@vela/rig-model`, `nats`, `@cria/*` |
| `@vela/rig-frames` | `node:fs/promises` (read functions only), `node:path`, `node:crypto`, `node:url`, `effect`, `@vela/rig-events` | any `node:fs/promises` function that writes, `node:fs`, `node:child_process`, any other `@vela/rig-*`, `nats`, `@cria/*` |
| any rig package or tool | | the rest of `@vela/*`, a deep `@vela/rig-x/src/...` path |

`packages/rig-events/src/wire.ts` is the one file that imports `@cria/wire`. It is a list of read-side re-exports and nothing else. `tools/rig-model/guards/wire-gateway.ts` holds the allowlist, so no rig code can name a Cria command.

## The site stays out of the repo

Vela is public. The real site comes from the mount's readings at runtime, and tests use a synthetic site. The check that keeps the real one out of the tree is described in [tools/rig-model/README.md](../tools/rig-model/README.md#no-real-site).

## Frame sources

`@vela/rig-frames` finds the frames Vela has already kept. It only reads, and a lint rule keeps write functions out of it. Everything it names is in Vela's data folder (`VELA_DATA_DIR`, by default `~/.local/share/vela`).

| Source | Where | Read as |
| --- | --- | --- |
| Saved images | `saved-images/<sha256 of rig id>/<sha256 of image id>/` with `metadata.json` and `original.fits` | `readSavedImages`. The folder names are checked against the metadata, as Vela's own store does. A `.pending-*` folder is an unfinished save and is skipped. |
| Frame records | `traces/frames.jsonl`, one line per settled exposure attempt | `readFrameRecords`. A last line without a newline is still being written and is left out. |
| Alignment trials | `alignment-diagnostics/trials/<run id>-<suffix>/journal.jsonl` and its FITS files | `readTrials`, through a schema that names no site field. It also reads each baseline and measurement's polar error (`readings`), with the time of its last sample. |

`joinFrames` joins images to records on `image.id` and puts every miss in a named bucket. An image captured before the rig's first record is `predatesRecords` (Vela began writing frame records on 2026-10-19). One captured after is `unexplained`, which the check treats as a failure. A record of a `saved` attempt whose image is gone is `missing`, also a failure. `unsaved` and `save-failed` records name images Vela did not keep, which is by design.

`frameDraft` turns a record into the `frame` fact of `@vela/rig-events`, with `origin: 'capture-run'`. Its `at` and `seenAt` are the moment the attempt settled.

`nightOf` names a night for the local date it starts, noon to noon. The package does not know the site, so the caller passes the site's UTC offset.

An alignment trial's journal holds the site in `evidence.physical.site` and in other fields. `readTrials` never carries those out, and its problems name a line and a reason, never the line's text.

`pnpm rig-model:frame-sources` reads the real data folder and prints the nights, the join and the trials.

## The model

`@vela/rig-model` is one pure reducer: `step(model, input) -> { model, out }`. It imports no clock, no network and no file, and a lint rule keeps it that way. `out` holds assessment drafts (`mount-position`, `pointing-fix`) and the model cannot publish them.

- **Input** is a `RigEvent` or a `ClockInput`. Time advances on Cria snapshots, stream and gap events, sessions and clock inputs, and on nothing else. A frame or a solve comes from another producer on its own schedule, so letting it move time would make a deadline depend on who delivered first. Before an input is applied, every deadline up to its time fires, each stamped when it fell due. The same events therefore give the same output whether clock inputs came every second or never.
- **`seenAt` is arrival on the stream's clock.** A frame's and a solve's `seenAt` decide whether a pair arrived within `joinExpiryMs` of the exposure, and whether a fix is too old to restore `known`. A source that replays recordings must stamp frames and solves with the time they would have arrived (capture end plus solve time), not with the time of the import. The model cannot tell an import clock from a late delivery, and treats both as late.
- **Mount position** is a closed state machine, `unknown | known | moving | uncertain`, with one function `nextMount` and its table in the doc comment. A move that began from `unknown` ends `unknown`, because a move can never invent knowledge. A Cria restart (a new `instanceId`) resets the position to `unknown`; the last fix is dropped.
- **Motion epochs** are stretches in which nothing could have moved the mount unseen. A motion, a data gap, a Cria restart, a mount going unavailable and a new setup each end the open epoch. `known` needs a solve whose whole exposure lies inside the current epoch with a camera timestamp. A solve from an older epoch is recorded with `effect: history-only` and never restores `known`.
- **The mount track** is a step function plus how far it is vouched for. A tracking mount writes few samples, so silence in the track means calm only while `coveredUntil` keeps up.
- **The join** (`joinFix`) is a pure function of the frame, its solve, the track, the epochs and the site. Both positions are put in J2000 at the exposure midpoint and compared on the tangent plane at the mount's position. A rejection carries a named reason and is published like a fix.

| Contract check (unit 4) | Where it is proved |
| --- | --- |
| An injected 0.9 degree azimuth shift gives the expected error vector | `packages/rig-model/test/pointing.test.ts`, first test |
| A slewing or older-epoch exposure is rejected | `pointing.test.ts` ("what is rejected"), `motion.test.ts` |
| Arrival-order shuffles give identical output | `order.test.ts` |
| Staleness from clock events matches between live-style and replay-style input | `time.test.ts` |

## Backfill

`pnpm rig-model:backfill` (in `tools/rig-model/`) runs the saved light frames through the model: it solves each with the real ASTAP (cached by the file's sha256), stamps the frame with the end of its exposure and the solve with its finish, and feeds a night's frames, solves and mount snapshots to `step` in the order they would have arrived. The mount comes from errai's INDI recordings where one overlaps the night, else from Vela's Cria journal. It reports alignment evidence, pointing residual and drift apart, and exits 3 (incomplete) when a change of the polar axis is bracketed but exposures Cria was told to take inside the bracket have no kept pixels. The command, its options and its exit codes are in [tools/rig-model/README.md](../tools/rig-model/README.md).
