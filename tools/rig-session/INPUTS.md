# rig-session: reading the INDI recording, frame records and journal

Status: spec. The packager (`README.md`) reads saved images, the trace file and a mount CSV. This adds three inputs: the recording and the frame records, which `session.json` already lists as missing, and the Cria journal, so a night that was recorded, packaged and replayed can answer: which Cria operation produced each saved frame, what the INDI traffic and mount state looked like around frame N, and which writes and errors happened during the exposure. It builds on `bots/observer/specs/rig-record-replay-design.md` (PR 5). The rules of the packager do not change: rebuildable and deterministic, an interrupted build leaves the old package readable, every link records how it was found (`exact`, `inferred`, `ambiguous`, else null), a missing input is listed in `session.json` with what it costs, inputs are read-only.

## Inputs

| Flag | File | Written by | Read as |
| --- | --- | --- | --- |
| `--frame-records <file>` | `frames.jsonl` (`VELA_FRAME_RECORDS_PATH`) | Vela, one line per settled attempt | `FrameRecord` in `apps/server/src/capture/frame-records.ts` |
| `--recording <dir>` | `manifest.json`, `traffic.jsonl`, `blobs/` | Cria's recorder (`@cria/recording`, `format.ts`) | damage as in "Damage" below; `blobs/` never read |
| `--journal <file>` | `cria-journal.jsonl` (`VELA_CRIA_JOURNAL_PATH`) | Vela's `@vela/cria` | `JournalEntry` in `packages/cria/src/v5/journal.ts` |

A line of the frame records or the journal that does not decode is skipped and listed in `session.json` (as for the existing inputs). The window picks the rows that start inside it, and a row a link points to is exported too.

## Damage

One policy for a recording that did not end well, stated here and nowhere else:

- A last line with no newline is a torn tail (Cria died mid-append). It is dropped and the build notes `tornTail` in `session.json`.
- A line that ends with a newline but does not decode is damage. The lines before it are kept, it and every line after it are ignored, and `session.json` lists the damage. The build does not fail, because the kept prefix is still true; reading on would join across a hole.
- Either way the last kept line is the end of the evidence. State the packager carries across time stops there: an INDI mount sample stays in force only until the last kept line, so a frame after it gets no mount link, the same as after a gap or a closed connection.

## Tables and columns

**PR a, frame records.** New table `attempts`, one row per frame record: `run_id`, `attempt`, `rig_id`, `started_at`, `settled_at`, `exposure_seconds`, `outcome` (`saved`, `unsaved`, `save-failed`, `lost`, `failed`, `uncertain`, `stopped`), `message`, `request_id`, `operation_id`, `cria_image_id` (the record's provenance, null for Alpaca), `frame_id`, `detected_stars`, `median_hfr_px`. Lost, failed and stopped attempts are rows with no frame. New `frames` columns: `run_id`, `attempt`, `request_id`, `operation_id`, `cria_image_id`, `attempt_link`, `attempt_candidates`.

**PR b, the INDI recording.** Each concept is its own PR.
- `indi_ops`: one row per `op` line: `operation_id`, `request_id`, `device_id`, `kind`, `accepted_at`, `started_at`, `settled_at`, `outcome` (`confirmed`, `failed`, `stopped`, ...), `outcome_reason`, `outcome_message`, `parameters` (JSON), `image_id`, `image_bytes`. Never the outcome's `values`, which carry the site (device setup).
- `attempts` and `frames` gain `operation_link`: `exact` when the id they carry is in `indi_ops`: the `operation_id`, or the `request_id` when the record has no operation id. An operation id that this recording does not hold is no match, and never falls back to the request id, so the exported `operation_id` is always the key the link used or null; a request-only match joins on `request_id`. `indi_ops` also keeps the image id, bytes and `image_sha256` of the operation.
- `indi_events`: one row per observable change on the wire: `at`, `conn`, `n`, `direction` (`in`, `out`), `kind` (`update`, `write`, `message`, `delete`), `device`, `property`, `state` (Idle, Ok, Busy, Alert), `values` (JSON, element to value) and `changed` (JSON, the elements that differ from the previous value), both null unless the property is on the packager's list of safe properties (see Privacy rule), `text` (for `message`), `operation_id`, `operation_link`. An `in` update with the same state and values as before is dropped. A `write` is a client `new*Vector`; its operation is the one on that device whose window covers `at`, the same Cria clock (`inferred`; `ambiguous` if several).
- `indi_images`: one row per camera BLOB: `at`, `conn`, `n`, `device`, `property`, `blob_bytes`, `operation_id`, `operation_link`, `image_id`. The BLOB belongs to the capture operation on that device whose window covers `at` (`inferred`, `ambiguous` if several). `frames` gain `blob_path` (the file the image was saved to), `blob_link` and `blob_candidates`: frame to operation is `exact`, operation to BLOB is `inferred`, so frame to BLOB is `inferred`.
- `mount` rows from the recorded mount properties (`source` column: `indi` or `csv`; the fields an INDI mount may not report are nullable): sample at each change of position, tracking, slewing (state Busy), park, pier side or track mode. Local sidereal time is computed from the recorded longitude, which is read and never written to a table. The frame to mount as-of link applies, with one difference: the driver reports only changes, so an INDI sample stays in force until the next one or until the evidence is lost: its connection closed, a gap, the end of the recording, damage (see Damage), the mount's `CONNECTION` turning off or the mount's properties being deleted. Losing the evidence also forgets what was accumulated: a sample after it never carries a field from before it (the CSV's 30 s rule is for polled samples).

**PR c, the journal.** `cria_requests` (one row per `exchange`: `at`, `ms`, `route`, `status`, `request_id`, `device_id`, `kind`, `reply_kind` `answered|refused|lost`, `reply_code`, `reply_message`, `operation_id` of an answered reply), `cria_image_checks` (one row per `image`: `at`, `image_id`, `operation_id`, `bytes`, `sha256`, `verdict`), `cria_state_changes` (one row per changed cell of a `state` entry: `at` arrival time, `generated_at`, `sequence`, `instance_id`, `cell`, `value` JSON, `removed`, `baseline`), and `cria_stream` events. The links live on the journal rows, not on `attempts`: `cria_requests` and `cria_image_checks` carry `run_id`, `attempt` and `attempt_link` (`exact`, by request id and by Cria image id) and `operation_link` to `indi_ops`; `cria_image_checks.sha_matches_operation` compares Vela's digest with the one Cria recorded for the operation. The journal's `origin` (a host address) is not exported. An operation cell of a state change drops the outcome value, as `indi_ops` does.

## Links

| From to | Key | Kind |
| --- | --- | --- |
| frame to attempt | saved `image.id` equals the record's `image.id` | `exact` (`ambiguous` if two records share it) |
| attempt or frame to operation | `operation_id`; `request_id` only when the record carries no operation id (Cria never admitted it, or the reply was lost) | `exact` |
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
7. A torn last line is dropped; a damaged middle line is handled as in "Damage": the lines before it are kept, it is listed in `session.json`, and the build finishes.
8. A journal request, image check and state change join to their attempt by id.
9. Rebuilding twice gives identical rows; a missing input says what it costs.
10. Privacy: a tape that writes the site and names a serial port builds a package in which no cell holds either, in a column nobody listed too; a planted secret fails the build and the old package stays readable.

## Privacy rule

Tests use synthetic data only (`synthesizeTape` or hand-made jsonl with made-up sites), and the scrub guard runs over them. A package is shared in conversation, so it never holds the observing site, a serial port path or serial number, a host address or a credential. The rule is held at one place, not field by field, because a list of private fields fails the day a field or an INDI property is added:

1. **One choke point.** `publishPackage` (`package.ts`) is the only code that turns rows into Parquet. It passes every string cell, and every string and key inside a JSON cell, through `sanitize` (`sanitize.ts`), whichever table or column it is in. The redactor never names a table or column; it reads the column kinds from `schema.ts`. A test builds a row for every table with a secret in every text and JSON column and checks the files; a table added to the schema is a type error in that test until it is covered.
2. **Two layers in `sanitize`.** *Learned values:* while the readers read the inputs they learn the secrets from the data itself: the recording's own site (`GEOGRAPHIC_COORD` latitude, longitude, elevation), `DEVICE_PORT` and `SYSTEM_PORTS` values, `/dev/` paths and elements named like a serial number, and the journal's `origin`. Any occurrence is replaced in any cell, in the usual spellings: decimal (rounded or truncated), signed or wrapped longitude, sexagesimal with colons, spaces or degree marks. *Patterns:* things that look private whatever their source: `/dev/` paths, `by-id` names, `LAT=`/`LONG=`/`ELEV=` pairs, a text that names the site in words (replaced whole), URL credentials and tokens, bearer tokens and key-looking strings. A JSON key that names the site, a port or a serial number loses its value.
3. **An allowlist for structured data.** What is exported is what a table names. The values of INDI properties are exported only for the properties the packager lists as safe (`indi.ts`); every other property still gives an event row (when, which device and property, which state) with no values. Operation outcome values, the journal's `origin`, and BLOB bytes are never exported. A new INDI property or journal field stays out of the package until someone adds it on purpose. Free text that is exported (a driver message, an attempt's message, a reply message) goes through `sanitize`.
4. **Fail closed.** After the staged package is written and before the symlink switches, every exported table and `session.json` are read back and scanned for the learned secrets and the patterns. A hit fails the build, removes the staging directory and leaves the previous package readable; the error names the table, column and rule, never the value. This is the backstop, not the primary defence.

Real-data acceptance scans every table of a real night for the recording's own site values and expects none.

## Known limits

What the packager does and does not promise, so nobody has to read the code to find out.

**Privacy.** The rule above is held at one place, but what it recognises is finite.
- *Covered:* a learned latitude, longitude (also as the wrapped 0 to 360 value) and elevation as decimals rounded or truncated to any precision, signed or not; the same values as degrees-minutes-seconds with colons, spaces or marks (`12:32:02.4`, `12 32 02`, `12°32'02"`); a text that names the site in words (replaced whole, which is how the one location message in the real night is spelled: "Observer location updated: Latitude ... Longitude ..."); `LAT=`/`LONG=`/`ELEV=` pairs; `/dev/` paths and `by-id` names; learned ports, serial numbers, the INDI host and the journal's `origin` of four characters or more, wherever they occur; URL credentials and tokens; a JSON key that names the site, a port or a serial number loses its value, and a late-learned value is removed from rows read earlier.
- *Not covered, known:* the sexagesimal spelling of a wrapped longitude (`-14:45:00` when the recorded value is `345.25`); full-width digits and other non-ASCII spellings; a decimal with leading zeros; a coordinate written as separate fields or numbers (`[12, 32, 2.4]`); numbers in numeric columns and JSON numbers are not compared with the learned site; the text of a JSON key is kept when the key starts with a site, port or serial word (its value is replaced); keys that look like credentials (`password`, `apiKey`) keep a value that has no recognisable token shape; learned texts shorter than four characters are not matched; an `origin` written with JSON escapes (`\/`) is learned as that text only if it also appears unescaped; operation `parameters` and trace `attributes` are sanitised, not restricted to a list of known keys. `mount.lst_hours` is derived from the recorded longitude, so the sidereal time and the time of a sample together identify the longitude (the mount CSV had the same column before this change).
- *Fail closed:* the build reads the staged files back and fails, leaving the old package readable, when it sees a learned text, a learned coordinate in a spelling it recognises, or a pattern. The check uses the same recogniser as the replacement, so it has the same gaps as the list above: it is a backstop for a defect in the writer, not a second opinion on the spellings.

**Size.** The inputs are streamed, so a file larger than a string or the heap can be read, and only the lines a table needs are kept as raw lines. The operations, INDI events, images and mount samples of the whole recording, and the journal entries inside the window, are kept in memory until the tables are written. For the real night (a 3.4 MB tape) the build peaks at about 460 MiB; the same traffic repeated to 216 MB, the size of an eight-hour night, builds with a peak of about 1.1 GB on the default heap and also completes with a 256 MiB heap. A recording of tens of thousands of large, all-different messages (700 MiB of 8 KiB messages) can exhaust a small heap; that is not what a night looks like, and nothing here caps it.

**Mount.** The mount is the first `mount` device in the manifest; a manifest with several mounts is linked to the first. A state change is tracked until a connection that carried the mount closes, a gap, the end, the mount's `CONNECTION` turning off or its properties being deleted, or the last line of a recording that did not end cleanly. A mount that re-sends the definitions of its properties without deleting them first is not treated as a boundary.

## Real-data acceptance

A script outside the repository builds a package from a real night, prints row counts and each frame's linked operation and link kind, runs a DuckDB query that joins a frame to the INDI events during its exposure, and rebuilds twice to compare rows. It is kept with the observer's scripts, not here.
