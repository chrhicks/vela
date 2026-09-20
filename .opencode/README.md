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

### Results panel preview

`/standards-results` opens the native terminal panel for this session's latest
completed check. A clickable summary above the composer also opens it. New
results update the summary without opening the panel or taking focus.

- `↑` / `↓` select files and judgments or scroll detail; concerns are listed first.
- `←` / `→` move between files, judgments, and the scrollable question detail.
- `A` toggles applicability scores and shows which standards cleared the cutoff.
- `F` switches between the side panel and full screen; narrow terminals use full screen.
- `R` reloads the saved result without calling Jev; `Esc` closes the panel.

The panel reads existing evidence through a plugin RPC. It shows the winning
answer, its probability, model confidence, the exact question, and alternative
answer probabilities. These are model judgments, not proof. Incomplete files
retain their error; saved answers from an invalidated evaluation are marked as
unaccepted. The timestamp identifies the saved evaluation, not current source
state. Older checks made before this preview do not populate its per-session
latest-result pointer; run a new check to populate it.

The TUI entrypoint is exported by `plugins/standards/package.json`; OpenCode loads
it alongside the server plugin. No global terminal configuration is needed.

Tool inputs:

```js
// Current tracked and untracked changes, compared with HEAD.
{}

// Whole files, including unchanged code.
{ mode: 'files', paths: ['.opencode/plugins/standards/jev.ts'] }

// Changes in selected files compared with another commit/ref.
{ paths: ['apps/server/src/example.ts'], base: 'origin/main' }

// Supply definitions or evidence without making them additional review targets.
{ mode: 'files', paths: ['path/to/test.ts'], supportingPaths: ['path/to/helper.ts', 'path/to/contract.md'] }
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
4. For standards **strictly above 0.70**, ask their specific Choice questions,
   supplying only those standards in the judgment request. `applicabilityThreshold`
   can override this experimental cutoff.
5. Return concise findings, for example `path/to/test.ts: async_tests`.

### Catalog coverage

Each standards section now has semantic questions: 12 groups and 47 specific
judgments. The original IDs remain stable:

| Standard ID | Questions cover |
| --- | --- |
| `readability` | Explicit critical path, domain names, local reasoning/simple interfaces |
| `formatting` | Consistency with surrounding style and unrelated diff churn |
| `types_boundaries` | Domain types, input validation, earned normalization, adapter isolation, shared contracts, semantic page views |
| `modules` | Narrow interfaces, visible composition/dependencies, deliberate effects, justified abstractions/dependencies |
| `state_persistence` | Valuable durable facts, current observations, presentation-owned browser state |
| `comments` | Useful comment rationale and owning durable documentation for changed behavior |
| `error_context` | Causes, honest operation state, transient read recovery, uncertain physical writes, confirmation, explicit safety policy |
| `tests` | Regression intent, deterministic/state-driven fakes, independent adapter references and failure coverage, public behavior, cross-boundary outcomes |
| `async_tests` | Pending state, controlled completion, completed-outcome assertions |
| `frontend` | Stable semantic components, hierarchy, responsive workflow, honest state, workshop evidence |
| `trust_boundaries` | Server-owned credentials/device access, browser-safe environment, validation, intended network exposure |
| `focused_verification` | Focused verification workflow and evidence-backed execution claims |

Exact whitespace/semicolon syntax belongs to deterministic tooling, not Jev. This
catalog does not add a formatting checker. It evaluates the semantic formatting
guidance only. Nor can source alone establish that commands ran, a specimen was
approved, or a view renders correctly. Those questions must abstain when necessary
evidence is missing; a file named `specimen` is not proof of workshop evaluation.

Use `supportingPaths` for relevant source, contracts, owning documentation, or
verification reports. They appear at `state.supporting_context` and are evidence,
not extra review targets or instructions. Reports need to identify the relevant
change/outcomes; missing context is not proof of either compliance or violation.
No automatic dependency traversal or collection of screenshots/execution history
is added. This remains a text-only, probabilistic prototype, not complete coverage
of standards in practice or independently calibrated detectors for each new rule.

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
- Review targets are JavaScript/TypeScript. Supporting paths can also be Markdown,
  text, JSON, or YAML. Ignored files and paths outside the checkout are excluded.
  Unsupported targets are listed as skipped; unreadable/deleted sources and API
  failures are reported as inconclusive.
- At most 40 KB per source file and 60 KB for each assembled state. Larger inputs
  are reported explicitly, never silently truncated. No automatic chunking or
  dependency traversal: supply small, relevant `supportingPaths` when needed.
- HTTP calls time out after 30 seconds. Stopping the OpenCode tool interrupts
  transport through the Effect plugin adapter. There is no automatic retry loop.
- Target source, supplied helpers, and standards are revalidated after each file's
  evaluation. Changed or unreadable inputs invalidate its findings. Results are
  observations of saved inputs, not certificates about later edits.

The first live self-check exercised the registered OpenCode tool on its own code.
A temporary mutation replacing Jev's contextual error/cause with `Error('Request
failed')` was flagged as `error_context`; the mutation was then removed. Real
results also included low-confidence `met` and `not_applicable` answers. Clean
summary output therefore means no selected check reported a violation, not proof
of compliance.

Expanded-catalog spot checks compared a real adapter with a validation-removal
mutation, plus small paired examples of retained preferences versus persisted live
run state and server-API delegation versus browser-held device credentials. The
targeted checks distinguished those pairs. They also emitted extra low-confidence
flags: an ordinary browser request wrapper was marked `error_context.cause` with
only 0.47 probability for the winning violation. Its code propagated fetch failures
and identified HTTP failures by operation/status; no supplied response contract
established additional missing details. That flag was not treated as a demonstrated
defect. These are spot checks, not accuracy measurements for all 47 judgments.

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
