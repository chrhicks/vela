# rig-session

Joins one outing's files into Parquet tables that DuckDB can query. It runs on the machine where you analyse a night, never on a rig, and the Vela server does not depend on it.

```sh
pnpm --filter @vela/rig-session rig-session build \
  --name 2030-01-01-example --from 2030-01-01T18:00:00Z --to 2030-01-02T12:00:00Z \
  --out ~/.local/share/rig-sessions/2030-01-01-example \
  --saved-images ~/.local/share/vela/saved-images \
  --traces ~/.local/share/vela/traces/observing.jsonl \
  --mount-csv path/to/mount-watch.csv \
  --frame-records ~/.local/share/vela/traces/frames.jsonl \
  --recording ~/recordings/2030-01-01-example \
  --journal ~/.local/share/vela/traces/cria-journal.jsonl

pnpm --filter @vela/rig-session rig-session query ~/.local/share/rig-sessions/2030-01-01-example/package \
  "SELECT detected_stars FROM frames ORDER BY captured_at"
```

The inputs are read-only. Every input is optional; `session.json` in the package lists the ones it found and, for each missing one, what that costs.

## Out of the box and your own data

**This repository holds no recordings and no packages, and everything here passes without them.** `pnpm test` and `pnpm scenarios` use synthetic tapes made by `synthesizeTape` (made-up site, camera and mount). They need `CRIA_CHECKOUT`, a clean Cria checkout at the pin in `src/replay/cria-checkout.ts` (see [Running Cria at a pinned commit](#running-cria-at-a-pinned-commit)). That is what CI covers; nothing in it comes from a real night.

**Your own set.** To verify against a real rig, record your own:

1. Turn on Cria's `record` config on the rig (the setting is in Cria's docs) and do a session.
2. Copy the recording to a folder outside every repository, for example `~/recordings/<name>`.
3. Build the package into `~/.local/share/rig-sessions/<name>` (the `build` command above).
4. Replay it with `pnpm replay ~/recordings/<name>`, and check the set with the command below.

**Privacy contract.** A recording and a package hold the site: coordinates, serial ports and hosts, and `mount.lst_hours` next to a UTC time gives the longitude. They are private. Never commit them, and never paste them, or a query result from them, into an issue or a pull request. The packager sanitises free text and fails the build closed when it sees a value it learned from the recording, but that does not make a package safe to publish; what it cannot recognise is listed in [Known limits](INPUTS.md#known-limits). The [scrub guard](#scrub-guard) protects committed fixtures only. The tools say so themselves: `build` and `accept` refuse an output folder inside a git working tree unless git ignores it (`--allow-in-repo` overrides).

### Check your own set

```sh
pnpm --filter @vela/rig-session accept \
  --recording ~/recordings/<name> --frame-records <frames.jsonl> --journal <cria-journal.jsonl> \
  --traces <observing.jsonl> --saved-images <saved-images dir> [--mount-csv <file>] \
  --from 2030-01-01T18:00:00Z --to 2030-01-02T12:00:00Z
```

It takes the inputs of `build` (all optional), builds a package twice into a throwaway folder (`--scratch`, default the temporary directory) and prints the row count of every table, the link counts per link (`exact`, `inferred`, `ambiguous`, none) and the inputs that were missing with what that costs. It exits 1, with the reason, if

- the second build is not byte-identical to the first (`session.json` apart from its build time);
- the privacy scan of every table and `session.json`, against the values the packager learned from your inputs, finds one. The message names the table, column and rule, never the value;
- an input changed while it ran (hashed before and after: the files the packager reads, not `blobs/` or the images). An input that only grew, like Vela's live journal, is a warning.

The output is counts and names only, never a cell of your data. Exit 0 means all three held.

## Package layout

`<out>/package` is a symlink to `<out>/builds/<time>`, which holds `frames.parquet`, `attempts.parquet`, `indi_ops.parquet`, `indi_events.parquet`, `indi_images.parquet`, `cria_requests.parquet`, `cria_image_checks.parquet`, `cria_state_changes.parquet`, `cria_stream.parquet`, `mount.parquet`, `spans.parquet` and `session.json`. A build writes into a fresh directory and switches the symlink with one rename, so a build that fails leaves the previous package readable. The next finished build removes the older directories.

Rebuilding the same inputs gives the same rows in the same files. Only `session.json` carries the build time.

## Tables

`src/schema.ts` is the one description of the tables. Row types, the `CREATE TABLE` statements and the export all come from it, so a column is added in one place.

Joins are plain functions in `src/joins.ts`. Each link records how it was found:

| Kind | Meaning |
| --- | --- |
| `exact` | A shared key joins the rows. |
| `inferred` | A rule over times joins them, so it is as good as the clocks. |
| `ambiguous` | Several rows fit. The target stays null and the candidates are listed. |

A link with no match is null. The packager never guesses.

- `frames.span_*` links a saved frame to the `capture.frame` span that was running when the camera started the exposure.
- `frames.attempt_*` links a saved frame to the frame record (`attempts` table, one row per capture attempt of any outcome) that names its image: `exact`, by the image id. The frame then carries that attempt's `request_id`, `operation_id` and `cria_image_id`, so it names the Cria operation that produced it. `attempts.frame_id` is the same link seen from the attempt; a lost or failed attempt has none. `attempts.message` is the adapter's or driver's own text, so `/dev/` paths and `LAT=`/`LONG=` pairs in it are replaced, and a text that names the site in words is replaced whole.
- `frames.operation_*` and `attempts.operation_*` link to the Cria operation in `indi_ops` (one row per `op` line of the recording): `exact`, by the operation id the frame record carries, or by its request id only when the record has no operation id (Cria never admitted the request). An operation id that the recording does not hold is no match: the request id is not tried, so `operation_id` is always the key the link used. `indi_ops.outcome*` hold the kind, reason and message; an outcome's values are not exported, because device setup puts the site in them.
- `indi_events.operation_*` links a wire event (an update, a write, a message) to the Cria operation whose window covers it on the same device: `inferred`, by the times Cria wrote on its own clock; `ambiguous` when several cover it (a power box that is both weather and switch). To see the writes and errors during frame N, join `indi_events` on the device and `at` between the frame's `captured_at` and the end of its exposure.
  `indi_events` has one row per first definition of a property on a connection (`define`), per change of state or value (`update`, with `changed` listing the elements that differ), per client write (`write`), per `message` and per `delete`. A `set` that restates the same values is dropped, except a BLOB. `values` and `changed` are filled only for the properties in `exportedProperties` (`src/indi.ts`: position, tracking, exposure, temperature, binning, focus, filter); any other property, the site and the ports among them, is still an event with those two columns null, until someone adds it on purpose. What the tracker remembers of a property is forgotten when its connection closes or the recording has a gap, so the next message reads as a first sight.
- `indi_images` has one row per camera image in the recording (the BLOB message, the file it was saved to under `blobs/`, the size INDI stated) and links it to the capture operation, `inferred`, whose window on that device covers its arrival (`ambiguous` if several do). `frames.blob_*` links a frame to the image of its operation: frame to operation is `exact`, operation to image is by time, so the chain is `inferred`, `ambiguous` if the operation window holds two images or an image fits two operations. It is not matched by content: Cria's `sha256` is over ImageBytes, not the FITS the recording keeps, and not by `DATE-OBS`, which Cria replaces with the dispatch time when the card is missing.
- `cria_requests` has one row per exchange Vela had with Cria (`--journal`): the command it sent (request id, device, kind, parameters), how the reply ended (`answered`, `refused` with Cria's code and message, or `lost`) and the HTTP status. It links to the attempt that carries its request id (`attempt_link`, `exact`; `ambiguous` if two attempts carry it) and to the Cria operation named by the reply, the route or the request id (`operation_link`, `exact`, null when the recording does not have it). A lookup or a stop has no command and so no attempt.
- `cria_image_checks` has one row per image Vela fetched: whether the original matched the size and digest its descriptor promised (`verdict`), linked `exact` to the attempt by the Cria image id and to the operation by its id. `sha_matches_operation` compares the digest Vela computed with the one Cria recorded for that operation, which is a content check of the frame (the BLOB in `indi_images` cannot be checked that way).
- `cria_state_changes` has one row per cell a state snapshot changed or removed (`device/<id>/readings.<field>`, `operation/<id>`), with the time the snapshot reached Vela and its sequence; the value is JSON, and an operation cell drops the outcome value. `cria_stream` has the event stream's `opened` and `ended` lines. A silent stream shows as a gap in `cria_state_changes.at`. Only operation cells and the device readings on the list in `src/journal-tables.ts` (`exportedReadings`) are exported: a mount reports its latitude, longitude, elevation and sidereal time as readings, and a device reports its own name, so those and any field Cria adds later stay out until someone adds them on purpose.
- `frames.mount_*` links a frame to the latest mount sample not after the exposure start, and keeps the sample's age. A polled sample (the CSV, `source = 'csv'`) older than 30 seconds gives no link. A sample from the recording (`source = 'indi'`) is a change of the mount's INDI properties (position, the position property being Busy for slewing, tracking, park, pier side, track mode), and the driver reports only changes, so it holds until the next one or until the evidence is lost, and what was accumulated is forgotten then (a later sample never carries a field from before): a connection that carried the mount closed, a gap, the end, the mount's `CONNECTION` turning off, its properties deleted, or, for a recording that did not end cleanly (damage, a torn tail, still being written), the last line read; `mount_age_seconds` is then how long ago the mount last changed. Sidereal time (and so hour angle) comes from the recorded longitude, which is read and never written to a table; with none they are null. When both sources have a sample at the same millisecond the recording's is kept.

`INPUTS.md` specifies how they will be, and the tables and links they add.

## Privacy

A package never holds the observing site, serial port paths or serial numbers, host addresses or credentials. This is held at the one place rows are written, not field by field: `publishPackage` (`package.ts`) passes every string cell, and every string and key inside a JSON cell, through `sanitize` (`sanitize.ts`), and no table or column is named there. A new column or table is covered without touching it.

`sanitize` has two layers. Learned values: the readers learn the secrets from the inputs themselves (the recording's site, ports and serial numbers, the journal's origin), and `Secrets` replaces each wherever it occurs, in the usual spellings (decimal rounded or truncated, signed or wrapped longitude, sexagesimal). Patterns: `/dev/` paths, `by-id` names, `LAT=`/`LONG=`/`ELEV=` pairs, URL credentials and tokens, bearer and key-looking strings; a text that names the site in words ("Observer location updated: Latitude ...") is replaced whole, and a JSON key that names the site, a port or a serial number loses its value.

After the staged files are written and before the symlink switches, the package reads them back and scans every table and `session.json` for the learned secrets and the patterns. A hit fails the build with the table, column and rule (never the value), removes the staging directory, and leaves the previous package readable. It is the backstop; `sanitize` is the defence. `INPUTS.md` ("Privacy rule") has the whole rule.

### The recording

A recording is read for `manifest.json` and `traffic.jsonl` only; `blobs/` is never opened. It is streamed, so a tape larger than memory builds in constant space, and only the lines a table needs are kept. As the lines pass, the reader learns the site (`GEOGRAPHIC_COORD`), the ports (`DEVICE_PORT`, `SYSTEM_PORTS`, any `/dev/` path), serial numbers and the INDI host from the manifest into the package's `Secrets`. A torn last line is dropped; a damaged line in the middle (or a line over 64 MiB) keeps the lines before it and `session.json` lists it. That policy is stated once, in `INPUTS.md` ("Damage").

### The journal

The journal is read as a stream and only the entries that start in the build's window are kept, so a journal that spans months builds in constant space. Each entry's `origin` (a host address) is never read into a table; it is learned, so the address and its host are removed wherever they occur. Lines that do not decode are listed in `session.json` (the first 1000).

## Replay

`pnpm replay <recording> [--from-frame N] [--name NAME] [--keep]` runs a Cria recording (from errai, or made up by `indi-replay synthesize`) through the real stack on this machine: `indi-replay` serves it like indiserver, the real Cria reads it, and the Vela server talks to that Cria as a rig named `replay: <name>`. It prints the three addresses and stops everything, and removes its files, on Ctrl+C. A relative `<recording>` is taken from the repository root.

```sh
CRIA_CHECKOUT=~/dev/personal/cria pnpm replay ~/recordings/<night> --from-frame 40
```

A recording can hold frames of more than one size, because someone changed the camera's frame or binning while it ran. Replay does not replay what a client wrote, so it serves a frame only when the camera is set to that frame's size, and otherwise the exposure fails with the two sizes in its message. Start with `--from-frame` at the first frame of the size you want: replay then sets the camera as it was when that frame's exposure began.

Every path the three programs write (Cria's images, Vela's rig catalog, saved images, frame records, journal, traces, survey cache) and `HOME`, `TMPDIR` and the XDG folders are inside one `vela-replay-*` folder in the temporary directory. They inherit nothing else of this process's environment, so no `VELA_*` variable or token leaks in. Their logs are in that folder's `logs/` (use `--keep` to read them after a stop). The Cria config is generated from the recording's `manifest.json`: its devices, none told to connect, no serial port and no site (a recording holds neither). A recorded switch device is left out because a recording does not name its channels.

### Running Cria at a pinned commit

`replay/cria-checkout.ts` holds the pin, the Cria commit that has `indi-replay` and `synthesizeTape`. It is not the `@cria/wire` pin in `pnpm-workspace.yaml`. That one is a git-path dependency (`github:chrhicks/cria#sha&path:/ts/packages/cria-wire`), which pnpm can install only for a package whose dependencies are all outside the Cria workspace. `apps/cria` and `indi-replay` depend on their sibling packages through `workspace:*`, and Cria commits no `dist/` for them, so a git-path dependency on either fails (`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`). So `CRIA_CHECKOUT` names a checkout, and replay refuses it unless it is at the pin, has no change to a tracked file under `ts/`, and has run `pnpm install --frozen-lockfile` in `ts/`. Cria then runs from its TypeScript source with its own `testing/source-hook.mjs`, so nothing is built there. Bump the pin and the checkout together.

Replay needs the Vela server built (`pnpm replay` does it first with `pnpm --filter '@vela/server...' build`).

### Scenarios

`runScenario(recording, options)` (`replay/scenario.ts`) starts the same rig, starts a capture, polls Vela's HTTP API until the attempts have settled, stops the run and tears the rig down. It returns the saved frames and their statistics as the API reports them, each attempt's outcome from the frame record file, the alerts Vela raised and the FITS bytes of each saved frame. A scenario is a `*.scenario.ts` file that asserts literal values; `pnpm scenarios` runs them (they start processes and take about three minutes together, so `pnpm test` does not). `result.alertChanges` lists the alerts Vela's alerts view showed, each time the set changed.

| Scenario | The fault | What Vela reports |
| --- | --- | --- |
| `camera-snag` | `blank` frames from frame 6 | star counts `12 x 6, 0 x 6`; `stars-collapsed` (critical) within two frames of the first blank one; mount tracking throughout |
| `am5-meridian-stop` | pre-meridian side, then a `set` fault turns tracking off at frame 7 | `meridian-near`, then `meridian-imminent`, then `tracking-stopped` |
| `faults` (silent) | the mount `silent` for 40 s | `rig-unreachable` after 30 s, cleared when the mount answers; every capture still saved |
| `faults` (disconnect) | every INDI connection closed during frame 3's exposure | the attempt ends `uncertain`, the run `failed` with Cria's reason, `run-failed` raised |

`synthesizeTape` (`replay/tape.ts`) makes the recording with the pinned Cria's `indi-replay synthesize`: small frames, a made-up site, a camera and a mount. Committed scenarios use only these.

### Nothing outside the temporary folder

Two checks, both re-runnable:

- `pnpm --filter @vela/rig-session exec tsx src/replay/containment.ts -- <command>` lists both repositories, `~/.local/share/rig-sessions` and `~/.config/vela` before and after the command, with `TMPDIR` pointing at a fresh folder, and exits 1 if anything outside that folder was added, removed or changed. (`~/.local/share/vela` is not watched by default: the live Vela writes it all day.)
- `tools/rig-session/sandboxed-scenarios.sh` runs the scenarios with the whole file system read-only except a fresh temporary folder (bubblewrap), so a write anywhere else fails.

### Scrub guard

`pnpm --filter @vela/rig-session scrub [repository]` (and `scrub.test.ts`, which runs in `pnpm test`) fails if a committed fixture holds what must not be in a public repository: a real observing site, in any shape (INDI `GEOGRAPHIC_COORD` latitude and longitude, latitude or longitude fields, a mount log whose UTC and `lst_h` columns imply a longitude), FITS location cards (`SITELAT`, `SITELONG`, `OBSGEO-*`, `OBJCTRA`, `OBJCTDEC` and the like), and `/dev/serial/by-id` paths. The made-up sites that may be committed are `fakeSites` in `scrub.ts`; the serial placeholders are listed there too. A finding names the file, line and rule and never the value. A fixture is a tracked data file (`.fits`, `.blob`, `.csv`, `.jsonl`, `.xml`, or any file under a `fixtures`, `golden`, `recordings` or `tapes` folder). `synthesizeTape` runs the same check on the tape it writes.

`knownExceptions` in `scrub-repository.ts` lists findings that were committed before the guard existed. An exception that no longer matches anything fails the test, so the list cannot outlive its cause.
