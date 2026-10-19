# rig-session

Joins one outing's files into Parquet tables that DuckDB can query. It runs on the machine where you analyse a night, never on a rig, and the Vela server does not depend on it.

```sh
pnpm --filter @vela/rig-session rig-session build \
  --name 2030-01-01-example --from 2030-01-01T18:00:00Z --to 2030-01-02T12:00:00Z \
  --out ~/.local/share/rig-sessions/2030-01-01-example \
  --saved-images ~/.local/share/vela/saved-images \
  --traces ~/.local/share/vela/traces/observing.jsonl \
  --mount-csv path/to/mount-watch.csv

pnpm --filter @vela/rig-session rig-session query ~/.local/share/rig-sessions/2030-01-01-example/package \
  "SELECT detected_stars FROM frames ORDER BY captured_at"
```

The inputs are read-only. Every input is optional; `session.json` in the package lists the ones it found and, for each missing one, what that costs.

## Package layout

`<out>/package` is a symlink to `<out>/builds/<time>`, which holds `frames.parquet`, `mount.parquet`, `spans.parquet` and `session.json`. A build writes into a fresh directory and switches the symlink with one rename, so a build that fails leaves the previous package readable. The next finished build removes the older directories.

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
- `frames.mount_*` links a frame to the latest mount sample not after the exposure start, and keeps the sample's age. A sample older than 30 seconds gives no link.

Frame records, the Cria recording and the Vela journal are not read yet. When they exist their formats add columns, tables and `exact` links here.
