# Direct standards review: bounded live check

On 2026-09-20 UTC, the rewritten full `checkStandards(directory, input, signal,
{ model, generate })` runner completed one three-target batch through
`openai/gpt-5.6-luna`, variant `medium`. It returned one source-validated
`error_context` warning for the deliberately degraded error wrapper, no
diagnostics on the two real application files, and no missing-evidence entries.
This is a small live integration observation, not a benchmark or merge verdict.

## Scope and setup

The cases were declared in the saved manifest before generation:

| Target | Predeclared question | Actual result |
| --- | --- | --- |
| `apps/server/src/alignment/diagnostics.ts` | Does a normalized public `AlpacaTelescopeStatus` cause a spurious protocol-leak finding? | No diagnostics. |
| `apps/server/src/alignment/diagnostics.test.ts` | Do sequential filesystem outcome tests attract artificial pending-state/control requirements? | No diagnostics. |
| Fixture-only `.opencode/plugins/standards/error-wrapper.ts` | Does replacing a contextual, cause-preserving throw with `Error('Check failed')` receive an actionable finding? | One warning: the wrapper discards its underlying cause and boundary context. |

The runner reviewed whole files in one `mode: 'files'` batch. No detector,
applicability gate, individual-rule filtering, or per-target generation intervened.
The ordinary `runner.ts` → `reviewStandards` path assembled evidence, generated
once, decoded the response, validated citations, rechecked source snapshots, and
saved its report. No exact-diff follow-up was needed. Whole-file review could have
reported genuine unrelated concerns; this response contained none.

Each isolated Git fixture retained the application paths and imports. The two
application targets and all current supporting documents were copied byte-for-byte.
`CODING_STANDARDS.md` and `AGENTS.md` were read by the runner. `supportingPaths`
supplied the diagnostic schema, replay implementation, alignment geometry, FITS
encoder, ALPACA framing implementation/public normalized types, package exports,
and ALPACA README. The historical wrapper came from the prior evaluation's
isolated fixture, renamed `error-wrapper.ts`; its adjacent `checks.ts` contained
only the historical `Verdict`/`Question` declarations (original lines 136–141).
Neither historical module was imported or executed. The deleted real `jev.ts`
was not restored; no TypeSafe credentials or requests were used.

Generation used exactly this transport and extracted `response.data.text`:

```text
/usr/lib/opencode-desktop/opencode-cli api post /api/experimental/generate \
  --data {"model":{"providerID":"openai","id":"gpt-5.6-luna","variant":"medium"},"prompt":"…"}
```

## Counts, failure, and timing

There were **two runner invocations, two generate-callback invocations, one
successful generation CLI launch, one Luna endpoint request and response, zero TypeSafe
calls, and zero HTTP 400 responses**. Each runner invocation called its injected
generator exactly once. There were no unchanged retries or outcome-chasing runs.

1. **23:57:43 UTC:** `incomplete`, `spawn E2BIG`, before the CLI/server ran.
   The 161,744-byte prompt met the reviewer's 180,000-byte limit, but its
   164,912-byte JSON command argument exceeded Linux's single-argument limit.
   Runner elapsed time: 151 ms; generator failure: 3 ms. Full input and error
   were retained. This was a real harness transport limitation, not a model
   refusal or clean review.
2. **23:58:36 UTC:** reduced supporting context by removing full acquisition,
   solver, and coordinates sources. The targets, standards, guidance, normalized
   telescope contract, and relevant recording/replay helpers stayed identical.
   Prompt: **124,159 bytes**; JSON argument: **126,536 bytes**; largest evidence
   file: **21,804 bytes**, below the 40,000-byte per-file limit.
   Runner: **43,244 ms**; reviewer: **43,137 ms**; CLI transport: **43,135 ms**.
   Result: `complete`, one warning, no unresolved code questions.

## Citation evidence

The actual prompt numbered the mutation correctly:

```text
59:   } catch (cause) {
60:     throw new Error('Check failed')
```

Luna cited **59–60**, quoting those exact source lines without numbering, and
related **49–55**, where HTTP, decoding, and missing-answer failures arise. Both
citations matched the retained source ranges and SHA-256
`ea089bb0de7a5b3e82a434bf69aafe6cad37583ad6d42ffc27f0b9e0bef205f4`.
An additional artifact check independently confirmed both quotes/hashes and all
numbered target/context texts. The runner accepted the warning rather than
rejecting it for a shifted line citation.

The warning distinguishes provider rejection, malformed responses, and local
decoding failures, and recommends a contextual error retaining `{ cause }`.
That is actionable for the mutation. Its suggestion does not explicitly mention
restoring `state.path`, so this observation proves cause/boundary recognition,
not a complete patch prescription.

## Retained evidence and limits

Ignored artifacts live under `.opencode/.local/direct-review/`:

- `summary.json`: exact aggregate counts, timings, hashes, numbering checks, and
  current-source equality checks.
- `SHA256SUMS`: hashes of every retained evidence file, excluding fixture Git internals.
- `2026-09-20T23-57-43.057Z/`: original input, local failure, fixture, manifest,
  execution script, implementation snapshot, and incomplete runner report.
- `2026-09-20T23-58-36.045Z/`: revised input, full CLI response, model response,
  fixture, manifest, execution script, implementation snapshot, full runner
  artifact, and citation validation.

Successful prompt SHA-256:
`3f062d792eb121af479736b16f27534a4dab9932f9286ca9d974411464b1e281`.
Response SHA-256:
`57f4f364dfc8610a90b8b66be74804e92dede367fc18d704558e08275f398f5c`.

Only one model response was sampled. The historical positive fixture is not
current product code. The model reported no missing context, but the fixture
does not contain every transitive dependency. Provider-internal attempts are
not observable from the CLI response; counts above describe harness requests.
The direct CLI adapter still needs smaller arguments for prompts near the
runner's 180 KB limit. This exercise does not validate the registered plugin,
RPC/TUI presentation, cancellation/error boundary tests, or independent verifier;
those remain separate delivery checks. No implementation files were edited and
no commits were made in the working repository.

## Registered-plugin check (parent session)

The actual tool was subsequently exercised through OpenCode Desktop CLI 2.0.11
in `--standalone` mode, using the plugin's native `ctx.generate.text` Effect
adapter, not the CLI JSON-argument generator above. Each tool invocation made
one isolated Luna review call.

- The first three-target self-review returned only `runner.ts` in reviewedPaths,
  omitting the newly added `reviewer.ts` and `evidence.ts`. The coverage validator
  rejected the entire response as **incomplete**. Its raw output also requested
  the changed function's call site, which had not been supplied.
- The prompt was changed to give every target an explicit `whole_file` or
  `changed_lines` scope and enumerate all required reviewed paths. A focused test
  covers mixed batches. The next call additionally supplied `index.ts` and the
  owning README as context. These were materially changed inputs, not an
  unchanged retry to seek a different judgment.
- At **2026-09-21 00:01:49 UTC**, the registered tool falsely returned **complete**.
  Independent verification found that its saved review took **90,005 ms**, had no
  model response, and lost the timeout error because Effect's `TimeoutError` has
  no `message`. The earlier claim of complete three-target coverage is withdrawn:
  this run established neither target coverage nor an empty diagnostic result.
- A separate shared-Desktop call reviewing `index.ts` and `panel.tsx` at
  **00:08:24 UTC** did retain an actual model response after **17,870 ms**, covering
  both targets with zero diagnostics. This distinguishes genuine generation
  from the false-complete timeout; it does not excuse that failure path.

Saved artifacts:

```text
.opencode/.local/standards/a4a0a2bd-abdf-4a3e-bf4e-c52f2a7cadba.json  # rejected omission
.opencode/.local/standards/b30187e3-6bad-4a2c-b91e-1bea0db8469c.json  # falsely complete timeout
.opencode/.local/standards/cc2b1ba4-f842-4806-9fd2-3043869ee5d0.json  # actual two-target response
```

The false-complete run's OpenCode session is `ses_f3ebb3b89ffeBMkqx5zIPJ1Fi8`, titled
“Direct standards diagnostics — mixed-scope check”. Its transcript is historical
evidence of the bug, not a successful review. The CLI transcripts are kept
at `/tmp/opencode/standards-direct-integration.jsonl` and
`/tmp/opencode/standards-mixed-integration.jsonl`. The three registered checks add
three attempted review calls to the fixture experiment: two retained model
responses and one timed-out call. Outer CLI agents also make their own
orchestration requests.

The correction tracks completion explicitly, sets it only after successful
output/coverage/citation validation, and retains a nonempty description for
message-less failures. A full-runner regression uses the installed Effect
timeout type. Loading an older falsely complete artifact without a model response
now yields an incomplete report instead of perpetuating that claim.

### Post-correction registered check

At **2026-09-21 00:12:13 UTC**, the actual `standards_check` tool in the existing
Desktop conversation reviewed the changed `runner.ts`, with `reviewer.ts`,
`report.ts`, `rpc.ts` and `evidence.ts` as supporting context. The saved raw
response is:

```json
{"reviewedPaths":[".opencode/plugins/standards/runner.ts"],"diagnostics":[],"missingEvidence":[]}
```

Artifact `.opencode/.local/standards/806a37df-0cbd-49ed-9bbf-859963fb3668.json`
records **7,261 ms**, an actual response, explicit review status `complete`, and
report status `complete`. This verifies successful registered-plugin generation
after the correction on one focused target, not successful coverage of the prior
three-target batch. The deterministic suite additionally verifies a real Effect
timeout through the full runner and reopening the pre-fix artifact shape.
