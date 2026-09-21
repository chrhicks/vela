# Bounded live standards evaluation

**Historical experiment, superseded by the direct-review design.** Chris approved
removing Jev and its applicability gate after this comparison. The current plugin
makes one direct Luna call and uses explicitly numbered sources. The record below
describes the prior implementation and preserves its failures without rewriting
them as successful results.

## Scope and method

This is a small, deliberately selected live comparison of Jev screening followed
by the bounded Luna investigator against direct standards-aware Luna review. It
is **not an accuracy benchmark or a cost estimate**.

The three cases were fixed before inference:

1. The original `apps/server/src/alignment/diagnostics.ts`, specifically whether
   its public normalized `AlpacaTelescopeStatus` contract is raw protocol leakage
   (`types_boundaries.protocol_isolation`).
2. The original `apps/server/src/alignment/diagnostics.test.ts`, specifically
   whether its sequential filesystem outcomes need artificial pending-state or
   controlled-completion machinery (`async_tests.pending`,
   `async_tests.completion`, and `async_tests.outcome`).
3. A fixture-only mutation of `.opencode/plugins/standards/jev.ts`: replace
   ``throw new Error(`Jev check for ${state.path} failed`, { cause })`` with
   `throw new Error('Check failed')` (`error_context.cause`). Only that mutation
   was in the positive case's review diff.

Each arm receives the same target snapshot, relevant `CODING_STANDARDS.md`
section, and rule questions. Both can request the same bounded evidence from a
small isolated Git fixture containing copied relevant source files. Negative
cases use whole-file review; the positive uses its one-line mutation diff. The
real source is never mutated.

The pipeline uses the actual `askJev`, applicability questions, judgment
questions, and `investigate` functions. It screens the one preselected standards
aspect at the runner's strict `> 0.7` threshold, then judges only the preselected
questions. Only `violated` or `insufficient_context` judgments become investigator
candidates. This exercises the relevant pipeline stages, **not an unrestricted
full-runner review of every standard**.

The direct arm uses the same `investigate` function, evidence reader, context
budgets, JSON schema, exact-quote validation, and target-diff citation checks. Its
candidate objects contain only neutral IDs, rules, and questions; the detector
field is absent. A prompt prefix explicitly says there was no detector stage and
that the questions are not allegations. It examines every preselected question,
including those the pipeline might filter out.

Reasoning generation uses `openai/gpt-5.6-luna#medium` through the authenticated
desktop CLI's `POST /api/experimental/generate`. The live server's OpenAPI
describes `{ "data": { "text": "..." } }`; transport responses are retained and
checked before extracting text. Jev uses `jev-1.13.0`; its credential is read with
Node's `parseEnv`, using only `TYPESAFE_API_KEY` from the authorized `.env`.
Credentials are excluded from artifacts.

There is one evaluation per arm/case, with no outcome-chasing reruns. Context
requests within an investigation are additional model calls, not independent
trials. Hard caps are twelve Luna generation calls and six Jev calls.

## Interpretation limits

- Three selected cases cannot measure general accuracy, precision, recall, or
  comparative reliability. Two explicitly target known historical false-flag
  patterns; the positive is a deliberately simple mutation.
- The questions and investigator instructions already discuss the normalized
  contract and sequential-async exceptions. Success on these cases is a narrow
  regression demonstration, not independent discovery of new rule semantics.
- Candidate selection and prompting differ: Jev filters the pipeline candidates
  and supplies judgments; direct review receives all neutral questions. The
  shared investigator is not an unconstrained standalone code-review agent.
- Supporting context is a bounded relevant-file fixture, not the complete
  repository. Missing essential evidence must remain inconclusive.
- A skipped aspect or no detector candidates is not a correctness verdict.
  Source citations establish source evidence, not runtime execution.
- Timings include transport and local process overhead. Arms run serially in a
  fixed order without repeated trials; latency observations are not benchmarks.
  The generation API provides no usage data, so call counts and elapsed times do
  not establish token consumption or financial cost.

## Results

Run: **2026-09-20 23:38 UTC**, worktree HEAD
`b9b3179711b1426bdb1aa91085e130bc4ebcf86f`, with the then-current uncommitted
standards implementation snapshotted separately. No inference was repeated.

| Case | Jev → investigator | Direct Luna | Calls: Jev / pipeline Luna / direct Luna |
| --- | --- | --- | --- |
| Normalized telescope contract | Applicability `0.96`; protocol-isolation judgment `met` (confidence `0.49`). No candidate, so no investigation. | CLI generation request failed with **HTTP 400 Bad Request**; no model response or verdict. | 2 / 0 / 1 attempted |
| Sequential filesystem test | Applicability `0.49`; aspect skipped at the `> 0.7` gate. | Returned three dismissals, but the investigation was **incomplete** because citation validation rejected the first range. None of those dismissals became validated findings. | 1 / 0 / 1 |
| Mutated error wrapper | Applicability `0.55`; aspect skipped, so the positive defect never reached judgment or investigation. | **One validated actionable finding**, citing the changed line 60 and identifying lost cause and operation/path context. | 1 / 0 / 1 |

**Totals:** four successful Jev requests and three Luna generation attempts (two
text responses, one HTTP 400). Seven external requests in total. The pipeline
produced no candidates and made **zero Luna investigation calls**. The direct arm
produced one validated actionable finding, zero validated dismissals, and two
incomplete case reviews. There were no context-read rounds in either arm.

The HTTP 400 happened after approximately 63 ms in the generation wrapper. Its
retained CLI error records the command and `HTTP 400 Bad Request`, but does not
contain a structured server error body. Its root cause is unresolved. Later
requests using the same explicit model reference succeeded and actually returned
the documented `data.text` shape; this does not establish why the first failed.
The failed request is counted as an attempt, not a confirmed model inference.

The filesystem response's quoted text exists, but its claimed locations are
wrong. Deterministic comparison against the frozen input established:

| Candidate | Claimed lines | Actual lines of the exact quoted text |
| --- | --- | --- |
| `async_tests.pending` | 39–50 | 41–52 |
| `async_tests.completion` | 53–57 | 56–60 |
| `async_tests.outcome` | 55–61 | 58–64 |

The validator reported
`Unverified source citation: apps/server/src/alignment/diagnostics.test.ts:39-50`.
The raw rationale correctly describes sequential completed operations, but that
does **not** turn the rejected response into a successful evidence-backed review.

### Observed elapsed time

| Case | Pipeline elapsed | Direct elapsed |
| --- | ---: | ---: |
| Normalized telescope contract | 616 ms | 67 ms (failed request) |
| Sequential filesystem test | 246 ms | 32,265 ms (rejected citations) |
| Mutated error wrapper | 470 ms | 10,767 ms |

Pipeline elapsed includes its applicable detector calls. Direct elapsed includes
generation and local validation/artifact overhead. These are single-run
observations, not a throughput or cost comparison. Jev returned usage fields in
its own responses; Luna's generation API did not. No combined token or financial
estimate is inferred.

## Supported conclusions

1. **The applicability gate can suppress a straightforward real defect.** In
   this positive fixture, error handling indisputably exists in the changed
   catch block, but Jev's `0.55` score prevented the cause-preservation check from
   running. Direct Luna found the defect with a valid changed-line citation.
   Investigating only candidates cannot recover a defect that was filtered out.
2. **The two historical false-flag patterns were not re-raised by Jev in this
   run.** One received `met`; the other was filtered as below threshold. This
   does not validate the code generally or demonstrate investigator dismissal of
   an erroneous detector concern, because no such candidate reached it.
3. **Exact citation validation prevented unsupported locations from appearing as
   accepted evidence.** It also made an otherwise plausible direct review
   incomplete. Live output-format reliability needs attention before treating
   this reviewer as dependable evidence production.
4. **This run does not demonstrate that the two-stage pipeline improves on
   direct Luna.** It did make fewer Luna calls, but omitted the positive defect.
   One transport failure and one rejected citation response prevent a complete
   comparison across all three cases. There is no measured accuracy or cost
   advantage here.

A follow-up implementation decision should address applicability gating and
citation production explicitly. No threshold, prompt, or implementation was
changed during this evaluation, and no additional inference was used to obtain
a more favorable outcome.

## Retained evidence and source integrity

Ignored raw artifact root:

```text
.opencode/.local/standards-evaluation/2026-09-20T23-38-50.771Z/
```

- `manifest.json`: predeclared cases, expected behaviors, model, budgets, base,
  and source SHA-256 hashes.
- `originals.json` and `fixture/`: exact source snapshots and isolated Git
  fixture; only the fixture's `jev.ts` has the mutation.
- `jev-calls.json`: exact detector states/questions, HTTP statuses, response
  bodies, and timings, without authorization headers.
- `<case>/input.json`: common source, standards, and questions.
- `<case>/direct/call-1.input.json`: actual model request, including the neutral
  direct-review prefix; `*.transport.json` retains successful raw stdout/stderr
  and timings, while `*.failure.json` retains the failed CLI error.
- `<case>/direct.json`: investigator findings, raw response, errors, and
  consulted-source hashes.
- `results.json`: all case outcomes, stage timings, and call counts.
- `source-validation.json`: all fourteen snapshotted real files still matched
  their original hashes when the run finished.

The bespoke driver remains ignored at
`.opencode/.local/standards-evaluation/run.ts` as historical provenance. It depends
on the pre-removal implementation and is not runnable against the current plugin.
It is not a normal test or CI command. A reusable committed evaluation runner was
not added: this bounded experiment exposed concrete gate/transport/citation
outcomes without requiring new production machinery.

Only this report is a durable change. Existing implementation, other agents'
tests/panel, and real diagnostic sources were not edited. The evaluation driver
ran successfully as a process; that process exit does not mean every review
succeeded. This evidence concerns source review, not application tests, rendered
UI, or physical hardware validation.
