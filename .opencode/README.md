# Jev standards-checking prototype

A project-local OpenCode **V2.0.8** plugin. Its purpose is to learn whether small,
typed Jev judgments help the coding agent notice standards problems in actual work.
It is a disposable experiment, not a merge gate or a comprehensive code reviewer.

## Use

From the Vela root, install the isolated tooling dependencies:

```sh
pnpm --dir .opencode install --ignore-workspace --frozen-lockfile --ignore-scripts
```

Provide `TYPESAFE_API_KEY` in the OpenCode server environment or this checkout's
root `.env`. The plugin reads that one value without modifying the server's
environment. It sends selected source and standards to TypeSafe.

OpenCode discovers `plugins/standards/index.ts` automatically. Watched plugin
changes reload automatically. For an existing session that has not discovered it:

```sh
opencode api post /api/location/reload --header "x-opencode-directory:$PWD"
```

The agent gets a `standards_check` tool and an instruction to use it after a
coherent batch of edits. Nothing runs automatically on each edit. You can request
a pass with `/standards`, or `/standards path/to/file.ts`. The command prompts the
active agent to call the tool and investigate its findings.

Tool inputs:

```js
// Current tracked and untracked changes, compared with HEAD.
{}

// Whole files, including unchanged code.
{ mode: 'files', paths: ['.opencode/plugins/standards/jev.ts'] }

// Changes in selected files compared with another commit/ref.
{ paths: ['apps/server/src/example.ts'], base: 'origin/main' }

// Supply definitions needed to understand a target without reviewing them too.
{ mode: 'files', paths: ['path/to/test.ts'], supportingPaths: ['path/to/helper.ts'] }
```

Paths are relative to the session's Git checkout root. The tool resolves the
session's current directory rather than assuming the plugin's loading directory.
`base` selects the comparison commit; it still reviews the current working tree.

## Flow and output

For each file or change:

1. Read source and, in changes mode, its diff. New files are reviewed in full.
2. Read relevant sections verbatim from `CODING_STANDARDS.md` into
   `state.coding_standards.<standard>`.
3. Ask an applicability Noul per standard.
4. For standards **strictly above 0.70**, ask their specific Choice questions.
   `applicabilityThreshold` can override this experimental cutoff.
5. Return concise findings, for example `path/to/test.ts: async_tests`.

The three checks are `comments`, `error_context`, and `async_tests`. The last has
separate questions for pending state, controlled completion, and outcome assertions.
These cover only selected aspects of the document, not every rule in each section.

For this prototype, a standard is flagged when any of its specific questions has
`violated` as its winning Choice. There is no judgment-confidence cutoff. A
winning `insufficient_context` is reported as inconclusive unless another question
already flags that standard. Raw subcheck results are always retained. Applicability
is not compliance, and a skipped check is not a pass.

The agent investigates why: read the source, consult the referenced standard, and
decide whether the issue is code, context, or the question. Jev generates no
explanation or fix. Do not rerun unchanged inputs to obtain a preferred verdict.

## Evidence and limits

- Raw requests/responses, selected source snapshots, file hashes, model IDs,
  timings, and results are saved to `.opencode/.local/standards/<id>.json`.
  The tool returns that path. These files contain source, are Git-ignored, and
  exclude authorization headers/API keys. Delete the directory when done.
- Model pinned to `jev-1.13.0`; questions live in `plugins/standards/checks.ts`.
- JavaScript/TypeScript only. Ignored files and paths outside the checkout are
  excluded. Unsupported files are listed as skipped; unreadable/deleted sources
  and API failures are reported as inconclusive.
- At most 40 KB per source file and 60 KB for each assembled state. Larger inputs
  are reported explicitly, never silently truncated. No automatic chunking or
  dependency traversal: supply small, relevant `supportingPaths` when needed.
- HTTP calls time out after 30 seconds. Stopping the OpenCode tool interrupts
  transport through the Effect plugin adapter. There is no automatic retry loop.
- Source changed during its evaluation is reported as stale. Results are observations
  of saved inputs, not certificates about later edits.

The first live self-check exercised the registered OpenCode tool on its own code.
A temporary mutation replacing Jev's contextual error/cause with `Error('Request
failed')` was flagged as `error_context`; the mutation was then removed. Real
results also included low-confidence `met` and `not_applicable` answers. Clean
summary output therefore means no selected check reported a violation, not proof
of compliance.

## Verify

Node 22.18+ is required for the local TypeScript test command.

```sh
pnpm --dir .opencode check
pnpm --dir .opencode test
pnpm lint
```

The focused tests use temporary Git repositories and request-driven fake API
responses; they need neither a real API key nor paid inference. They cover routing,
diff inputs, missing answers, excluded paths, cancellation, and changed inputs.
Repository lint currently excludes `.opencode`; the dedicated typecheck/tests
verify this tooling. Run the actual tool for semantic feedback separately.

Implementation: `index.ts` registers OpenCode contributions; `runner.ts` assembles
inputs and curates results; `checks.ts` owns questions/source sections; `jev.ts`
handles the HTTP and response-validation boundary.
