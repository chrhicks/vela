# Vela

Read [SOUL.md](./SOUL.md) at the start of each session for the collaboration voice. This file is the product authority for Vela; where older documents disagree, this file wins.

Vela is Chris's personal astronomy-control application. It lets him operate and monitor his astrophotography rigs from a modern web interface instead of Windows-only tools such as N.I.N.A. It runs on his home and observatory network and should work on the Omarchy desktop and on a phone near the rig. Vela is open source, but hypothetical users should not make it more complicated than Chris's real workflows require.

How work is done (review, PRs, delivery, general standards) is owned by Shared Coding. Load it through Executor with `skills({app:"shared-coding",name:"shared-coding"})`. This file owns what is specific to Vela.

## What Vela protects

- **Chris stays in command.** Show the rig's actual state, its current action and the outcome of each command. Automate routine work without hiding intent or pretending uncertain work succeeded.
- **Honesty about state.** Keep a last-known view during an interruption, mark its age and disconnected state, and reconnect quietly. Never present stale telemetry or imagery as live, or an unconfirmed command as successful.
- **The active observatory comes first.** Connecting, controlling, capturing and understanding what is happening come before planning, recovery machinery, deployment or post-processing.
- **A calm, visual interface.** Show the situation before the data behind it. Use correct domain language with clear hierarchy and progressive detail, not an everything-at-once control panel.
- **Intentional features.** Build the smallest capability that supports a real workflow, then extend it from evidence.
- **Understandability.** Chris should be able to read a few dozen lines on the critical path and know what happens. If he has to trace many layers or keeps asking why pieces connect, simplify the names, boundaries or state model before adding documentation.

## The active observatory

During an observation, Vela should make it easy to answer:

1. What is my rig doing right now?
2. Are its devices connected, healthy and behaving as expected?
3. What does the most recent exposure look like?
4. What is being observed, where is it in the sky, and what result should I expect?
5. What happens next, and when?
6. What details explain the current situation?

"Live" imagery means the most recent exposure, treated as first-class operational state.

### Capture runs, not durable sequences

A capture run repeats exposures with the requested parameters until Chris stops it. It lives in the Vela server's memory, so a browser can disconnect and reconnect without ending it. If the Vela server or the rig's Cria service crashes or restarts, the run is interrupted and Vela reports that honestly. To report it after its own restart, Vela keeps one small record of the active run's request and progress; on start it shows that run as interrupted, raises one alert, and offers Resume, which starts a new run for the remaining frames only when Chris asks (vela#169). Vela never starts exposures by itself after a restart. Nothing more: no durable sessions, automatic continuation, rebuild-and-reconcile, run history or general workflow engine.

### Local network before deployment

Vela works across the local network, including from a phone at the rig. Running as a service, hosted access and cloud architecture are not current work. Don't assume every process lives on one machine, but don't add containers, service management or authentication platforms in advance.

Desktop suits broad operation, configuration and image inspection; a phone suits checking state at the rig, such as during polar alignment. Decide what each workflow needs at each breakpoint rather than shrinking the desktop layout.

### Non-goals

Vela is not a complete N.I.N.A. replacement, a hosted or multi-user platform, an autonomous safety guardian, a universal planning system, a plugin ecosystem, or a calibration, stacking and processing suite. Acquisition, latest-exposure preview, quality inspection and artifact organization fit; deep post-processing belongs in specialized tools.

## Rig modes

Vela talks to each rig in exactly one mode, chosen at composition. There is no fallback between them.

- **Alpaca:** direct to an Alpaca server, for devices such as the Seestar.
- **Cria:** HTTP and SSE to Cria on the rig's local PC, for the FRA 400 and any rig with a PC managing its devices. Cria lives in the separate `chrhicks/cria` repository.

Both sit behind `@vela/equipment`. Workflows depend on its capabilities, never on a concrete adapter. See [docs/architecture.md](docs/architecture.md).

Cria holds only its newest completed images and Vela fetches each one right after its capture succeeds. A frame Cria has dropped is lost; Vela reports it and never exposes again to repair it. There is no archive, receipt or custody protocol between Vela and Cria; do not add one back.

## Engineering taste

- **Make the critical path read like the workflow.** Explicit flow, domain names, small interfaces and local reasoning. Hide genuinely hard sophistication behind a simple interface.
- **Adapters absorb irregularity.** Wire formats, protocol errors, malformed responses and device quirks stay in adapters, which expose stable Vela concepts. An adapter doesn't know which feature uses it.
- **Concrete capabilities, strong primitives.** Implement today's capability directly and generalize after repeated use. Invest in primitives that make capabilities composable and removable, not in speculative product behavior.
- **Visible composition.** One obvious composition point per runtime shows which capabilities and adapters are active and how they connect. No dynamic provider matrix, ambient service bag or untyped message bus hiding real coupling.
- **Use the existing stack coherently.** Add a dependency only when it absorbs real boundary complexity.

See [CODING_STANDARDS.md](./CODING_STANDARDS.md) for concrete coding defaults.

## State, failure and physical devices

Persist durable user facts and valuable artifacts: rig configuration, preferences, saved images and their metadata. Connection status, command progress and capture runs are ephemeral, except the one interrupted-run record above.

- A transient read failure during an interactive workflow keeps the session and its context, marks measurements as interrupted and retries at a paced, cancellable interval. Polar alignment keeps its baseline and revalidates device state before publishing another measurement.
- A substantive or uncertain operation stops rather than entering a retry engine.
- After an ambiguous physical write, inspect the device if its adapter has a reliable state query.
- Never blindly replay a command whose outcome is unknown. If inspection can't resolve it, stop and tell Chris what is known.
- A new Vela server or Cria instance means anything in flight before it is unknown. Start fresh; don't reconstruct.
- Heavy image processing stays on the Vela server, not the rig PC.

Operational preconditions are facts (a disconnected camera can't expose). Safety policy is Chris's: Vela may highlight concerning conditions and run protective behavior he configures, but it does not block or park the rig on its own.

## Working with Chris

The agent owns implementation, testing, documentation, PRs and delivery across the repository. Chris designs new screens with atraeus in Paper; implement the approved design faithfully and bring material departures back to him. The [workshop operations guide](docs/component-workshop-operations.md) covers promoting components into `@vela/ui`.

Review is light by default and only P0/P1 findings block. Chris's browser acceptance clears user-facing changes.

### Hardware validation

The FRA 400 and Seestar are normally on and available for building Vela. Inspect actual state before acting, and stop if you find conflicting activity or an unresolved command outcome. Run only the device checks the task needs, and leave hardware in the agreed final state or its observed starting state; report any cleanup you couldn't confirm. Ask Chris for hands-on recovery such as restarting the FRA 400's mini PC or power cycling devices.

## Repository map

- `apps/server` — Fastify API, rig configuration, and in-memory runs and workflows; the trusted boundary to the rigs.
- `apps/web` — React and Vite control surface; renders what the server projects.
- `apps/workshop` — source-backed environment for building and checking reusable components.
- `packages/equipment` — transport-neutral equipment capabilities shared by both adapters.
- `packages/alpaca` — Alpaca protocol, transport, discovery and normalization.
- `packages/cria` — Cria HTTP/SSE client and wire validation.
- `packages/model` — dependency-light contracts shared by server and browser.
- `packages/ui` — design tokens, stable components and drafts.
- `tools/rig-session` — offline packager that joins an outing's saved metadata, traces and mount log into Parquet tables for DuckDB. Outside the server's dependency graph. Also `pnpm replay`, which runs a Cria recording through the real Cria and this server, and the scenarios built on it ([README](tools/rig-session/README.md#replay)). It passes with no recordings; recordings and packages are private and never committed ([README](tools/rig-session/README.md#out-of-the-box-and-your-own-data)).
- `tools/trace-report` — one stdlib Python script that reads the observing traces (`VELA_TRACE_PATH` plus `.1` to `.4`) and prints a JSON report: frames attempted, completed, saved and not saved by outcome, timing, read retries, interruptions matched to recoveries, and the warnings that limit them. Run `python3 -I tools/trace-report/trace_report.py PATH [--since ISO] [--frames FRAMES.jsonl]` where the traces are; `--help` and the report's `definitions` block state each count. It never imports Vela or touches hardware, and its tests (`python3 -I -m unittest discover -s tools/trace-report`) use synthetic traces only.
- `tools/star-bench` — replays Vela's saved frames through Vela's own star measurement and compares the result with what Vela recorded. It is the check every change to `apps/server/src/imaging/statistics.ts` runs against recorded data before it ships. It reads saved images and writes nothing there, and never touches a rig, Cria or the running Vela. The command and its options are in the [README](tools/star-bench/README.md#run-it-on-thuban).

Read nearby READMEs before changing a boundary. See the [Rift workspace guide](docs/rift-workspaces.md) for parallel task workspaces. Linear project: **Vela - Main Development**.
