# horizon-import

Converts a backyard horizon survey (`horizon-data.json`: `stepDeg`, `samples[]` with `az`, `smooth` and `supported`) into the rig's approximate horizon profile, `horizon-<rigId>.json`, in Vela's data directory. The file's shape and meaning are in the [targets README](../../apps/server/src/targets/README.md#backyard-horizon-approximate-warn-only). The survey and the profile are private site data. Neither goes in the repo, a log or a test.

```sh
pnpm --silent --filter @vela/horizon-import horizon-import SURVEY_JSON \
  --rig RIG_ID --dir DATA_DIR --az-offset DEG --alt-offset DEG [--step DEG]
```

| Option | Meaning |
|---|---|
| `--rig RIG_ID` | The rig's id from `rigs.yaml`. Letters, digits, hyphens and underscores. |
| `--dir DATA_DIR` | The directory that holds `rigs.yaml`. Never guessed. |
| `--az-offset DEG` | Added to every survey azimuth. The survey's north is not demonstrated true north. Required. |
| `--alt-offset DEG` | Added to every altitude. Required. |
| `--step DEG` | Output bin size, default 1. Must divide 360. |

Each survey azimuth plus the azimuth offset falls in one output bin. A bin keeps the highest `smooth` altitude of its samples plus the altitude offset, between 0 and 90. A bin with no sample, or with any unsupported sample, is unknown (`null`): the survey could not trace it, and it is shown as unknown, never as clear and never as blocked. The file is written atomically with mode 600, so running it again replaces the profile and a running server picks it up on its next request.

The command prints the path and the counts of traced and unknown bins, never altitudes. Exit code 0 means the file was written, 2 means bad arguments or an unreadable survey. Tests run on a synthetic survey: `pnpm exec vitest run tools/horizon-import`.
