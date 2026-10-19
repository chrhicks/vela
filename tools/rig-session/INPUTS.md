# rig-session: reading the INDI recording, frame records and journal

Status: built (PRs #141 to #147); amended after the build where it differed: damaged recording lines, the mount rule, and where the journal links live. The packager (`README.md`) reads saved images, the trace file and a mount CSV. This adds the three inputs that `session.json` lists as missing, so a night that was recorded, packaged and replayed can answer: which Cria operation produced each saved frame, what the INDI traffic and mount state looked like around frame N, and which writes and errors happened during the exposure. It builds on `bots/observer/specs/rig-record-replay-design.md` (PR 5). The rules of the packager do not change: rebuildable and deterministic, an interrupted build leaves the old package readable, every link records how it was found (`exact`, `inferred`, `ambiguous`, else null), a missing input is listed in `session.json` with what it costs, inputs are read-only.

## Inputs

| Flag | File | Written by | Read as |
| --- | --- | --- | --- |
| `--frame-records <file>` | `frames.jsonl` (`VELA_FRAME_RECORDS_PATH`) | Vela, one line per settled attempt | `FrameRecord` in `apps/server/src/capture/frame-records.ts` |
| `--recording <dir>` | `manifest.json`, `traffic.jsonl`, `blobs/` | Cria's recorder (`@cria/recording`, `format.ts`) | torn last line dropped; a damaged middle line keeps the lines before it, ignores the rest and is listed in `session.json`; `blobs/` never read |
| `--journal <file>` | `cria-journal.jsonl` (`VELA_CRIA_JOURNAL_PATH`) | Vela's `@vela/cria` | `JournalEntry` in `packages/cria/src/v5/journal.ts` |

A line that does not decode is skipped and listed in `session.json` (as for the existing inputs). The window picks the rows that start inside it, and a row a link points to is exported too.

## Tables and columns

**PR a, frame records.** New table `attempts`, one row per frame record: `run_id`, `attempt`, `rig_id`, `started_at`, `settled_at`, `exposure_seconds`, `outcome` (`saved`, `unsaved`, `save-failed`, `lost`, `failed`, `uncertain`, `stopped`), `message`, `request_id`, `operation_id`, `cria_image_id` (the record's provenance, null for Alpaca), `frame_id`, `detected_stars`, `median_hfr_px`. Lost, failed and stopped attempts are rows with no frame. New `frames` columns: `run_id`, `attempt`, `request_id`, `operation_id`, `cria_image_id`, `attempt_link`, `attempt_candidates`.

**PR b, the INDI recording.** Each concept is its own PR.
- `indi_ops`: one row per `op` line: `operation_id`, `request_id`, `device_id`, `kind`, `accepted_at`, `started_at`, `settled_at`, `outcome` (`confirmed`, `failed`, `stopped`, ...), `outcome_reason`, `outcome_message`, `parameters` (JSON), `image_id`, `image_bytes`. Never the outcome's `values`, which carry the site (device setup).
- `attempts` and `frames` gain `operation_link`: `exact` when the id they carry (`operation_id`, else `request_id`) is in `indi_ops`. `indi_ops` also keeps the image id, bytes and `image_sha256` of the operation.
- `indi_events`: one row per observable change on the wire: `at`, `conn`, `n`, `direction` (`in`, `out`), `kind` (`update`, `write`, `message`, `delete`), `device`, `property`, `state` (Idle, Ok, Busy, Alert), `values` (JSON, element to value), `changed` (JSON, the elements that differ from the previous value), `text` (for `message`), `operation_id`, `operation_link`. An `in` update with the same state and values as before is dropped. A `write` is a client `new*Vector`; its operation is the one on that device whose window covers `at`, the same Cria clock (`inferred`; `ambiguous` if several).
- `indi_images`: one row per camera BLOB: `at`, `conn`, `n`, `device`, `property`, `blob_bytes`, `operation_id`, `operation_link`, `image_id`. The BLOB belongs to the capture operation on that device whose window covers `at` (`inferred`, `ambiguous` if several). `frames` gain `blob_n` and `blob_link`: frame to operation is `exact`, operation to BLOB is `inferred`, so frame to BLOB is `inferred`.
- `mount` rows from the recorded mount properties (`source` column: `indi` or `csv`; the fields an INDI mount may not report are nullable): sample at each change of position, tracking, slewing (state Busy), park, pier side or track mode. Local sidereal time is computed from the recorded longitude, which is read and never written to a table. The frame to mount as-of link applies, with one difference: the driver reports only changes, so an INDI sample stays in force until the next one or until its connection closed, a gap or the end of the recording (the CSV's 30 s rule is for polled samples).

**PR c, the journal.** `cria_requests` (one row per `exchange`: `at`, `ms`, `route`, `status`, `request_id`, `device_id`, `kind`, `reply_kind` `answered|refused|lost`, `reply_code`, `reply_message`, `operation_id` of an answered reply), `cria_image_checks` (one row per `image`: `at`, `image_id`, `operation_id`, `bytes`, `sha256`, `verdict`), `cria_state_changes` (one row per changed cell of a `state` entry: `at` arrival time, `generated_at`, `sequence`, `instance_id`, `cell`, `value` JSON, `removed`, `baseline`), and `cria_stream` events. The links live on the journal rows, not on `attempts`: `cria_requests` and `cria_image_checks` carry `run_id`, `attempt` and `attempt_link` (`exact`, by request id and by Cria image id) and `operation_link` to `indi_ops`; `cria_image_checks.sha_matches_operation` compares Vela's digest with the one Cria recorded for the operation. The journal's `origin` (a host address) is not exported. An operation cell of a state change drops the outcome value, as `indi_ops` does.

## Links

| From to | Key | Kind |
| --- | --- | --- |
| frame to attempt | saved `image.id` equals the record's `image.id` | `exact` (`ambiguous` if two records share it) |
| attempt or frame to operation | `operation_id`, else `request_id` | `exact` |
| journal request to attempt | `request_id` | `exact` |
| image check to attempt | Cria `image_id` | `exact` |
| journal request to operation | reply or route operation id, else `request_id` | `exact` |
| state cell `operation/<id>` to operation | `<id>` | `exact` |
| BLOB to operation | same camera device, `at` inside the operation window | `inferred` / `ambiguous` |
| write to operation | same device, `at` inside the window | `inferred` / `ambiguous` |
| frame to BLOB | through the operation | `inferred` / `ambiguous` |
| frame to mount | as-of join (existing) | `inferred` |

The BLOB is not matched by content (the journal's image check does confirm the frame's content, see `sha_matches_operation`): Cria's `sha256` is over ImageBytes, not the FITS file, so the FITS hash joins to nothing without converting it with `@cria/fits` (left open). A BLOB is not matched by `DATE-OBS` either, since `capturedAt` falls back to dispatch time.

## Scenarios (written as tests, synthetic data only)

1. Two saved frames, three records (one lost): frames link `exact` to their attempts, the lost one is an attempts row with no frame.
2. A saved image with no record, and a record whose image was never saved: null link, no guess.
3. Two records with the same image id: `ambiguous`, candidates listed, ids null.
4. A tape with one capture operation and one BLOB inside its window: BLOB `inferred`, frame to BLOB `inferred`; two BLOBs: `ambiguous`; none: null.
5. A write during an exposure appears in `indi_events` with that operation.
6. Mount samples from a tape fill `mount`, and a frame inside an exposure links to the latest sample with its age.
7. A torn last line is dropped; a damaged middle line is listed in `session.json`, the lines before it are kept and the build finishes.
8. A journal request, image check and state change join to their attempt by id.
9. Rebuilding twice gives identical rows; a missing input says what it costs.
10. Privacy: a tape that writes the site and names a serial port builds a package in which no cell holds either.

## Privacy rule

Tests use synthetic data only (`synthesizeTape` or hand-made jsonl with made-up sites), and the scrub guard runs over them. The packager keeps the recording's site and serial paths out of every table, because a package is shared in conversation: the properties `GEOGRAPHIC_COORD`, `DEVICE_PORT` and `SYSTEM_PORTS` are never exported with values, any text that holds `/dev/` is replaced, `LAT=`/`LONG=` pairs in messages are replaced, and operation outcome values are dropped. Blob bytes and the journal's origin are never read into a table. A test builds a package from an input that contains each and checks every cell.

## Real-data acceptance

A script outside the repository builds a package from a real night, prints row counts and each frame's linked operation and link kind, runs a DuckDB query that joins a frame to the INDI events during its exposure, and rebuilds twice to compare rows. It is kept with the observer's scripts, not here.
