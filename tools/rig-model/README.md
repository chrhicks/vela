# rig-model

Checks and offline tools for the rig model packages (`@vela/rig-*`, see [docs/rig-model.md](../../docs/rig-model.md)). They run on a development machine and never touch a rig or Cria.

Needs Node 26: the scripts here are TypeScript that Node runs directly.

| Command | What it proves |
| --- | --- |
| `pnpm check` | lint, `rig-model:guards`, `rig-model:no-real-site`, build and tests, in that order. The rig model packages are part of the repository's one check. |
| `pnpm lint` | oxlint with the rig model's import rules in `.oxlintrc.json`. |
| `pnpm rig-model:guards` | each rule bites. `guards/fixtures/bad/<case>` holds one deliberately bad file per rule and an `EXPECT` file naming the diagnostic. `fixtures/good` holds files that must pass. A rule that stops biting fails here. It also proves the `no-real-site` behaviour below. |
| `pnpm test` | vitest, including `packages/rig-sky/test/parity.test.ts`, which compares `@vela/rig-sky` with `apps/server/src/astronomy/coordinates.ts` on 1,000 seeded random cases with a synthetic site. |
| `pnpm rig-model:resolve-trial` | re-solves the three baseline frames of alignment trial `2bfbf00c` (2026-10-26) with ASTAP and compares each with the solve Vela recorded for it. It also checks each file against the sha256 the trial recorded, so it is the same pixels. ASTAP and its catalogue are read from `~/.local/share/vela/astap`; the trial from `~/.local/share/vela/alignment-diagnostics/trials`. It prints separations and timings, never coordinates, and exits 1 if any centre is more than `--tolerance-arcsec` (default 2) from the recorded one. |
| `pnpm rig-model:decode-journals` | decodes every line of Vela's two Cria journal files in `~/.local/share/vela/traces/` (or the paths you pass) with `@vela/rig-events`. It prints a count per kind and exits 1 on any failure. It reads the files and writes nothing. The live file grows, so its counts rise between runs. Takes about two minutes. |
| `pnpm rig-model:no-real-site` | no tracked or untracked text file holds a value from the forbidden list. Binary files and files over 8 MiB are not scanned, and the check names each one it skipped. Add `-- --history` to scan git history too. |

Pass options to a tool after `--`, for example `pnpm rig-model:resolve-trial -- --tolerance-arcsec 1`.

## no-real-site

Vela is public, and the real observing site must not appear in it. Tests use a synthetic site. The check reads forbidden values from `~/.config/rig/forbidden-values.txt` (one per line, mode 600, never committed) or from the file named by `RIG_FORBIDDEN_VALUES` or `--forbidden`. Its report names the file, the line and the entry number, never the value.

The list lives outside the repository, so a CI runner does not have it:

- **Locally**, a missing or empty list fails the check (exit 2). A check that cannot look proves nothing.
- **In CI** (`CI` set and not `0` or `false`), a missing list at the default path skips the check with a message and exit 0. An empty list, or a list you named that is missing, still fails.

`pnpm check` therefore runs the scan on Chris's machines and passes through on a runner. The guards prove all three behaviours.

Alignment trial journals hold the site in `evidence.physical.site`. Never commit or print them.
