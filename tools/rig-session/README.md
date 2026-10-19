# rig-session

Joins one outing's files into Parquet tables that DuckDB can query. It runs on the machine where you analyse a night, never on a rig, and the Vela server does not depend on it.

```sh
pnpm --filter @vela/rig-session rig-session build \
  --name 2030-01-01-example --from 2030-01-01T18:00:00Z --to 2030-01-02T12:00:00Z \
  --out ~/.local/share/rig-sessions/2030-01-01-example \
  --saved-images ~/.local/share/vela/saved-images \
  --traces ~/.local/share/vela/traces/observing.jsonl \
  --mount-csv path/to/mount-watch.csv \
  --frame-records ~/.local/share/vela/traces/frames.jsonl

pnpm --filter @vela/rig-session rig-session query ~/.local/share/rig-sessions/2030-01-01-example/package \
  "SELECT detected_stars FROM frames ORDER BY captured_at"
```

The inputs are read-only. Every input is optional; `session.json` in the package lists the ones it found and, for each missing one, what that costs.

## Package layout

`<out>/package` is a symlink to `<out>/builds/<time>`, which holds `frames.parquet`, `attempts.parquet`, `mount.parquet`, `spans.parquet` and `session.json`. A build writes into a fresh directory and switches the symlink with one rename, so a build that fails leaves the previous package readable. The next finished build removes the older directories.

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
- `frames.mount_*` links a frame to the latest mount sample not after the exposure start, and keeps the sample's age. A sample older than 30 seconds gives no link.

The Cria recording and the Vela journal are not read yet. `INPUTS.md` specifies how they will be, and the tables and links they add.

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
