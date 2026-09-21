# Standards review

A Vela-local OpenCode V2 tool: **selected code + repository standards → one Luna
review → source-backed diagnostics**. It has no detector stage, confidence gate,
secondary agent, autonomous investigation loop, or automatic edits.

The output is LSP-like: file and line range, stable rule ID, severity, explanation,
related source evidence, and a suggested correction. Missing code context and
failed or stale reviews are check status, not warnings on innocent source lines.

## Use

Install the isolated tooling dependencies (OpenCode plugin APIs pinned to 2.0.8):

```sh
pnpm --dir .opencode install --ignore-workspace --frozen-lockfile --ignore-scripts
```

OpenCode discovers `.opencode/plugins/standards/` automatically. The tool uses
the existing OpenCode provider connection for **`openai/gpt-5.6-luna#medium`**.
No TypeSafe account, API key, or project `.env` is needed. Selected source,
supporting context, and repository guidance go to the configured model provider.

To use another available reasoning model, set the plugin's `reviewerModel` option:

```jsonc
{
  "plugins": [{
    "package": "./.opencode/plugins/standards",
    "options": { "reviewerModel": "openai/gpt-5.6-luna#medium" }
  }]
}
```

The agent receives a `standards_check` tool and a reminder to use it after a
coherent batch of edits. Nothing runs on individual edits or keystrokes.
`/standards` asks the active agent to review current changes; `/standards path.ts`
asks for whole-file review.

```js
// Current tracked and untracked changes against HEAD.
{}

// Explicit whole-file review.
{ mode: 'files', paths: ['apps/server/src/example.ts'] }

// Current source compared with a particular base commit.
{ paths: ['apps/server/src/example.ts'], base: 'origin/main' }

// Relevant contracts/docs help the model resolve a specific code question.
{ paths: ['apps/server/src/example.ts'], supportingPaths: ['packages/model/src/example.ts'] }
```

Paths are relative to the session's Git checkout root, including after a session
moves to a worktree. `base` selects the comparison commit, not a different source
checkout. Supporting files are evidence, never additional review targets. New
files are reviewed in full; removed files cannot supply post-image diagnostics
and are reported incomplete. Unchanged targets and non-JS/TS paths are skipped.

For an existing location that has not discovered the installed plugin:

```sh
opencode api post /api/location/reload --header "x-opencode-directory:$PWD"
```

## Diagnostics and check status

The model reads `CODING_STANDARDS.md`, `AGENTS.md` when present, numbered target
source/diffs, and explicit supporting context in one isolated call. It does not
inherit the coding conversation, use tools, execute tests, or request follow-up
generation automatically. The caller can supply newly identified missing context
on a later check; unchanged inputs should not be rerun for a preferred answer.

`checks.ts` maps stable rule IDs to document section headings. It contains no
independent question catalog or applicability rules. The documents remain the
authority. A diagnostic must have:

- an exact target source range and quotation;
- a known section-level rule ID, such as `error_context` or `types_boundaries`;
- severity (`error`, `warning`, or `information`), a specific message, an
  explanation of concrete impact, and the smallest useful suggested correction;
- exact source references for any related evidence.

The plugin validates the response structure, accounts for every target, verifies
quotes/ranges against saved sources, and checks that changes-mode diagnostics
touch changed lines. Pure deletions may cite a surviving boundary; replacements
must cite an added line. Invalid output is rejected atomically and remains
incomplete. Citation validation establishes grounding, not model correctness.

An incomplete review can contain valid diagnostics alongside unresolved code
questions or unreadable targets. A stale review retains its historical evidence
but none of its diagnostics are accepted as current. Skipped paths are always
visible. “No diagnostics” does not mean certified correct or approved to merge.

### Relationship to the repository verifier

This tool supplies focused feedback during implementation. The coding agent
checks the evidence, corrects concrete issues, and performs focused verification.
The fresh-context `vela-verifier` still independently reviews the PR at delivery.
Its policy and verdicts are unchanged; give it only the PR URL, not this tool's
conclusion as inherited authority. It does not need to invoke this tool itself.

Whether commands ran, a workshop specimen was accepted, rendered behavior was
correct, or hardware behaved correctly belongs to delivery verification. The
standards tool does not turn missing execution evidence into source diagnostics
or routine missing-context warnings.

## Results panel

In the terminal UI, `/standards-results` or the composer summary opens the latest
saved review. Desktop receives diagnostics in the tool's conversation output;
the panel is a native terminal contribution.

- `↑` / `↓` select diagnostics or scroll evidence.
- `←` / `→` move between the list and detail; narrow layouts expand focused detail.
- `S` switches between diagnostics and check status, including empty reviews.
- `F` expands the panel, `R` refreshes saved evidence, and `Esc` closes it.

The panel separates diagnostics from check status, including missing evidence,
errors, and skipped paths. Its model and timestamp identify a saved source snapshot.
Refresh reloads evidence and rechecks source freshness without inference. Legacy
detector reports show a clear notice and retain their original JSON artifact;
there is no legacy detector implementation in the plugin.

## Evidence and bounds

- One model call per check with reviewable targets; none if input validation fails
  or all targets are skipped. Generation times out after 90 seconds.
- Up to 30 target paths and 30 supporting paths; 40,000 UTF-8 bytes per source;
  180,000 bytes per assembled prompt; 48,000 bytes per response. Limits are
  explicit failures, never silent clipping. Select a smaller coherent batch.
- JS/TS targets; supporting text can also be Markdown, JSON, YAML, or plain text.
  Ignored files, symlinks, credential-named paths, binary files, and paths outside
  the checkout are excluded. Linux `/proc/self/fd` verifies the opened file.
- Cancellation reaches source reads and the model generation fiber. This does
  not guarantee when remote provider work or billing stops. The plugin adds no
  retry loop; provider infrastructure may have its own transport policy.
- Source versions, including standards and guidance, are checked after review
  and on saved-report load. Changed or unavailable evidence makes the result stale.
- `.opencode/.local/standards/<id>.json` stores the report, prompt, raw response,
  model reference, timings, source snapshots/hashes, and base commit. These files
  contain source, are Git-ignored and created with mode 0600. Oversized responses
  are rejected without retaining their body. Delete old artifacts when unneeded.

The [historical comparison](standards-evaluation.md) records why the detector
gate was removed. It is a small experiment, not a general model accuracy benchmark.
The [direct-review observation](standards-direct-review.md) records the positive
and negative regression cases, exact citations, and registered-plugin checks.

## Verify

```sh
pnpm --dir .opencode check
pnpm --dir .opencode test
pnpm --dir .opencode test:render # Bun; renders the actual native TUI
pnpm lint
```

Node 22.18+ runs the TypeScript tests. They use temporary Git repositories and
injected model responses, with no credentials or paid inference. The Bun render
check exercises the real component at wide and narrow terminal sizes and saves
captures in `.opencode/.local/panel-render/`. Repository lint excludes `.opencode`;
the dedicated typecheck, behavioral tests and native render check cover this tool.

Boundaries: `index.ts` composes OpenCode generation/contributions; `runner.ts`
collects one batch; `reviewer.ts` builds and validates one model review;
`evidence.ts` owns source snapshots; `report.ts` loads/formats saved evidence;
`rpc.ts` defines the diagnostic/report contract; `panel.tsx` presents it.
