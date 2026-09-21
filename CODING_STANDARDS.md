# Vela Coding Standards

These are Vela's current coding defaults. They are intentionally small and expected to evolve with the application. Apply them with judgment; when a convention makes the code less clear or conflicts with a concrete technical constraint, discuss the tradeoff rather than working around it silently.

Product and architectural intent lives in [AGENTS.md](./AGENTS.md).

## Readability

Code is Vela's primary documentation. A reader should understand ordinary behavior from its names, structure, and flow without relying on a nearby explanation.

- Keep the successful critical path explicit and easy to follow.
- Prefer domain names over framework or implementation vocabulary.
- Keep functions and modules focused enough to reason about locally.
- Push protocol, framework, and vendor complexity behind narrow boundaries.
- Isolate warranted sophistication so callers use a simple interface.
- Prefer visible structure over fewer lines or tokens. Neither a shorter file nor a longer one is inherently more readable.

If an area requires repeated cross-file tracing to explain, inspect the architecture before adding comments or another abstraction.

## Formatting

Keep simple units compact. Expand code when doing so makes its fields, actions,
decisions, or hierarchy easier to see. Readability is the goal, not fewer lines
or more lines.

Preserve local domain names, APIs, and architectural patterns. Use these
formatting defaults for new and edited code even when nearby code is denser;
existing layout is not the formatting standard. Apply them to the logical block
being changed, without unrelated file-wide cleanup.

### Basic layout

- Indent with two spaces; do not use tabs.
- Omit semicolons unless syntax requires one. Do not use semicolons to pack
  multiple statements onto one line.
- Use blank lines to separate meaningful steps or groups. Keep closely related
  bindings together; do not separate every statement mechanically.
- Judge wrapping by length and complexity. Do not fill lines to a target width
  or expand every expression merely for consistency.

### Parameters, arguments, objects, types, and arrays

- Keep short function signatures and calls on one line. Around two or three
  substantial parameters or arguments, consider their combined length and
  expand when that makes them easier to scan.
- When a parameter or argument list is expanded, put each item on its own line
  and the closing parenthesis on a separate line. An object argument may keep
  its delimiters with the call, as in `capture({ ... })`.
- Give substantial object literals, types, and destructuring patterns one field
  per line. Small nested objects can remain inline inside an expanded object.
- Keep small, easily absorbed objects inline. Field count alone does not decide
  the layout: shorthand values are lighter to read than calculations or nested
  expressions.
- Apply the same principle to arrays: keep small, cohesive lists inline, and
  expand substantial lists to one item per line. Long React hook dependency
  arrays should put each dependency on its own line; short ones can stay inline.

```ts
const previewSize = { width: 960, height: 640 }

return { title, canStop, countLabel }
```

```ts
return {
  elapsedSeconds,
  remainingSeconds,
  fraction: Math.min(1, elapsedSeconds / exposureSeconds)
}
```

### Guards and callback bodies

- Short terminal guards may stay inline without braces. For a longer guard,
  put its action on the next indented line. Use braced blocks for multiple
  statements and for branches that group workflow actions.
- Keep simple expression callbacks inline. Expand callbacks that perform
  multiple actions, with one statement per line.

```ts
if (startedAt === null) return null

if (exposureSeconds <= 0)
  throw new Error('Exposure duration must be positive')
```

```ts
const cameraNames = cameras.map(camera => camera.name)
```

```ts
onProgress(progress) {
  latestProgress = progress
  publishProgress(progress)
}
```

### JSX

- Wrap multiline returned JSX in parentheses and indent the markup inside them.
- Put nested and sibling elements on separate lines so the hierarchy is visible.
  Short leaf elements can stay on one line.
- Keep short prop lists inline. Expand long prop lists to one prop per line;
  put the closing `>` or `/>` on its own line when the opening tag is expanded.
- For substantial conditional markup, keep the condition together and wrap the
  JSX in parentheses on subsequent lines. A short condition and short element
  can remain inline.
- Use blank lines between meaningful visual groups rather than between every
  element.

```tsx
return (
  <section className="capture-summary" aria-label="Current capture">
    <header>
      <h2>{activity.rigName}</h2>
      <span>{activity.status}</span>
    </header>

    {activity.progress && !activity.interrupted && (
      <progress
        value={activity.progress.value}
        max={activity.progress.max}
        aria-label="Exposure progress"
      />
    )}

    {activity.interrupted && <p>Showing the last confirmed state.</p>}
  </section>
)
```

### Conditional expressions

- Keep a short ternary for a simple choice. If the binding makes the line long,
  the expression may begin on the next indented line.
- A short ternary chain can remain an expression when its precedence is easy
  to follow. When wrapping it, put `?` and `:` branches on separate lines and
  indent each further decision to show the nesting.
- Keep chains to one or two decisions. Three decision levels are a code smell:
  prefer explicit branches rather than merely wrapping the chain over more
  lines. Even two decisions should become branches if the expression is hard
  to follow.

```ts
const countLabel =
  view.completedCount === 1 ? '1 image' : `${view.completedCount} images`

const title = view.interrupted
  ? 'Readings interrupted'
  : view.active
    ? 'Capturing'
    : 'Ready'
```

Do not add comments, redundant variables, wrapper functions, or abstractions
merely to make code appear more expansive. First make the existing structure
easy to read.

Do not add a formatter, linter, Git hook, or CI check solely to enforce these
preferences unless Chris asks for one.

## Types and boundaries

Types should clarify the domain and the critical path.

- Infer local types when the result is clear.
- Name important domain values and states explicitly.
- Prefer simple discriminated models over boolean combinations with unclear meaning.
- Avoid type-level cleverness that is harder to understand than the behavior it protects.
- Validate untrusted runtime input at HTTP, configuration, file, and device-protocol boundaries.
- Normalize external values before they enter application workflows, then use the normalized contract directly. Further checks should protect a new domain condition or trust boundary, not repeat validation already earned upstream.
- Keep raw ALPACA fields, response envelopes, device numbers, transport details, and protocol errors inside `packages/alpaca` or another appropriate adapter boundary.
- Keep browser/server shared contracts in `packages/model` free of transport, persistence, React, and application behavior.
- Resolve server-owned application state into intentional, renderable concepts in page-level views. The browser owns visual composition, copy, and formatting, but should not reconstruct domain state or duplicate precedence, reconciliation, or capability logic.
- Keep views semantic and typed rather than reducing them to generic property bags or preformatted display strings.

Do not widen a shared model merely because an adapter exposes more data. Add values the application can name and use intentionally.

## Modules, capabilities, and dependencies

Prefer narrow public interfaces and visible construction.

- A capability should expose the smallest interface its consumers need.
- Depend on contracts, not concrete adapter or extension implementations.
- Assemble concrete implementations at an obvious composition point.
- Avoid ambient mutable state, giant service bags, and generic messaging that hides real dependencies.
- Keep side effects at deliberate boundaries rather than interleaving them throughout domain decisions.
- Add dependencies when they absorb real complexity or provide a proven primitive.
- Prefer the current stack over introducing overlapping ways to solve the same problem.

Do not build registries, dynamic loading, provider matrices, or plugin compatibility machinery without a concrete capability that needs them.

## State and persistence

Persist facts because they remain valuable after restart, not because every operation can theoretically be resumed.

Good persistence candidates include configuration, preferences, retained captures, artifact metadata, and other deliberate user-created facts.

Connection state, progress, command status, and active capture loops are normally ephemeral. Read current state from the responsible device or runtime when possible. If the server restarts, in-flight work may end.

Keep browser state close to presentation needs. Prefer current server projections and local unsaved form state over duplicating server workflow logic in the client.

## Errors, retries, and device commands

Prefer state models that let the same event read honestly from the device boundary through the server view to the screen. Requested, attempted, observed, and confirmed are different facts. Give uncertainty and cleanup their own meaning rather than inferring them from a general success flag or an aborted request.

- Preserve enough context to identify the operation and boundary that failed.
- Translate low-level failures into stable boundary errors without discarding their meaningful cause.
- Retry known transient reads with bounded individual requests and a paced, cancellable wait. An active interactive session may keep retrying until recovery or the user stops it; preserve its context and show the interruption explicitly. A single read timeout must not force the user to repeat physical preparation.
- Do not blindly replay a physical command after an uncertain result.
- Query device state to reconcile ambiguity when the protocol offers a reliable observation.
- Stop and surface unresolved uncertainty rather than creating broad recovery machinery.
- Never report success before the responsible boundary confirms it.

A command may reject a known impossible device state. Do not turn environmental facts or operator preferences into implicit safety policy.

## Tests

Prefer fewer intentional tests over many broad-reaching ones.

Name a plausible regression each test catches, and establish that the test would
fail if it happened. For asynchronous behavior, establish the pending state,
control completion, and assert after the relevant result arrives. Prefer fakes
that respond to requests and state over scripts that advance merely because a
function was called. When the protection is unclear, try a targeted temporary
mutation; do not require a mutation campaign for every change.

### Adapter tests

Use the governing protocol and representative external evidence as an independent reference for adapter behavior. Before requesting independent verification, review changed operations as well as values: method, endpoint, parameters, completion meaning, valid domains and sentinels, capability relationships, and required-versus-optional support. Check how malformed, unsupported, or contradictory responses affect completeness. A fake should be able to disagree with the implementation, rather than repeat its assumptions.

Exercise the complexity the adapter exists to contain:

- wire decoding and runtime validation
- malformed and partial responses
- normalization
- known vendor or protocol quirks
- bounded timeout, cancellation, and retry behavior where relevant

Use deterministic fakes. Tests should not require real observatory hardware or LAN discovery.

### Capability and workflow tests

Test observable behavior through the capability's public interface. Substitute simple boundary implementations and avoid asserting internal call choreography unless that choreography is itself the contract.

Follow a few representative outcomes across the boundaries they cross: what the server publishes, what the client accepts, and what Chris is told should describe the same event. Include meaningful no-op, interrupted, and failed outcomes when they expose different behavior; avoid an exhaustive state matrix.

Prefer one focused test that proves an important behavior over broad snapshots, excessive mocking, duplicated permutations, or tests that make harmless refactoring expensive.

## Comments and durable documentation

Comments and documents should preserve context unlikely to become stale:

- why a non-obvious constraint exists
- invariants a boundary must protect
- why an apparently simpler approach is incorrect
- public contracts and intended usage
- durable architectural decisions and their rationale

Do not narrate line-by-line behavior, repeat types in prose, or document temporary implementation shape as though it were architecture. Rewrite unclear code before explaining around it.

When behavior or a boundary changes, update the durable document that owns that concept. Avoid creating competing descriptions of the same source of truth.

## Frontend and UI

- Prefer semantic components from `@vela/ui` over one-off substitutes when an appropriate stable component exists.
- Develop and evaluate reusable component work through `apps/workshop`.
- Keep visual hierarchy focused on current activity and actionable state.
- Surface technical detail progressively instead of making every value equally prominent.
- Treat responsive behavior as workflow design, not only CSS reflow.
- Make disconnected, stale, pending, failed, and confirmed states visually distinct.
- Do not present a stale image or value as live.

Read `apps/workshop/README.md` and the component workshop documents before changing the workshop, token system, or component promotion flow.

## Trust boundaries

The Fastify server is the trusted boundary for local observatory devices.

- Device protocol calls and credentials belong on the server, not in the browser bundle.
- Browser-safe environment values use `VITE_*`; secrets do not.
- Validate values crossing HTTP, device, file, and configuration boundaries.
- Do not expose the server beyond its intended host or network merely to make development convenient.

This security boundary is separate from rig safety policy. Protecting credentials and access does not require Vela to autonomously decide how Chris should protect his equipment.

## Focused verification

Use the smallest command that proves the change, then widen only when the affected boundary warrants it.

Once relevant checks pass, broaden or repeat them only for new changes, failures, or unresolved concerns. Add tests for meaningful behavior and reachable failure cases; do not add tests that merely mirror implementation or assert documentation wording. This stopping rule also applies to workshop work and independent verification.

Run a specific Vitest file from the workspace root:

```sh
pnpm exec vitest run path/to/file.test.ts
```

Build one package or app:

```sh
pnpm --filter @vela/model build
pnpm --filter @vela/alpaca build
pnpm --filter @vela/server build
pnpm --filter @vela/web build
pnpm --filter @vela/ui build
pnpm --filter @vela/workshop build
```

Run the model package's focused suite:

```sh
pnpm --filter @vela/model test
```

This runs the model's contract typecheck before its runtime tests. Plain Vitest
execution does not check `expectTypeOf` assertions. Use
`pnpm --filter @vela/model test:types` for type contracts alone. The root test
command also includes this check and excludes generated `dist` tests.

Run `pnpm lint` as part of code verification. It reports findings without modifying
files; apply available fixes explicitly with `pnpm lint --fix` and review the diff.

When a change crosses several workspace boundaries, run the full check:

```sh
pnpm check
```

This runs lint, tests (including model type contracts), then the workspace build
and its TypeScript checks, stopping on the first failure. Report failures
explicitly rather than suppressing them or claiming the check passed.
`pnpm test` and `pnpm build` remain available individually for focused validation.

A documentation-only change normally needs link, path, and content review rather than a code build.
