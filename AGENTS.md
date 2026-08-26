# Vela

Vela is Chris's personal astronomy-control application. It exists so he can operate and monitor his astrophotography rigs from a modern web interface instead of depending on Windows-only tools such as N.I.N.A.

The current product is local to Chris's home and observatory network. Its control surface should work well on the Omarchy desktop and at useful responsive breakpoints on a phone. A hosted service, internet-scale remote access, and broad adoption by other astronomers are possible futures, not present requirements.

Vela is open source, and other people may eventually find it useful. For now, hypothetical users should not make the product more complicated than Chris's real workflows require.

## What Vela should protect

### 1. Chris remains in command and understands the system

Vela should make the rig's actual state, its current action, and the outcome of commands clear. It should automate routine work without hiding intent or pretending uncertain work succeeded.

Chris should also retain an intuitive understanding of the code. A working feature that leaves him unable to explain how Vela works is not an unqualified success.

### 2. The active observatory comes first

The most valuable version of Vela helps Chris operate an observatory now. Rich planning, workflow recovery, deployment infrastructure, and post-processing should not delay the core loop of connecting to a rig, controlling it, capturing images, and understanding what is happening.

### 3. The interface stays calm, visual, and approachable

Astrophotography produces many technical values. Vela should use correct domain language without requiring Chris to mentally reconstruct the situation from tables of coordinates, temperatures, or device properties.

Show the situation before the data behind it. Prefer useful visual context, clear hierarchy, and progressive detail over an everything-at-once control panel.

### 4. Features are intentional

It is easier to add a feature after a real need appears than to remove a speculative feature after it shapes the product. Build the smallest capability that supports the current workflow, then extend it from evidence.

This applies especially when a simple action starts turning into a comprehensive subsystem.

### 5. Strong boundaries keep change inexpensive

Minimal product scope does not require weak foundations. Vela benefits from small, durable primitives and clear capability boundaries that let one area evolve without spreading its assumptions throughout the application.

Complexity should live at a boundary that can explain it, not in the middle of the workflow that uses it.

### 6. Understandability is architectural feedback

A few questions while learning an area are normal. If Chris must trace many layers, learn incidental framework machinery, or repeatedly ask why pieces connect, pause and reassess the design.

Do not assume the answer is more documentation. First ask whether the names, boundaries, state model, or flow can become simpler.

## A note from Chris

Vela is for me—Chris, Christopher, or chicks—and it grows with my astrophotography practice. I am still learning the domain, so I do not want to reproduce every option offered by mature tools. I want Vela to reflect the workflows I use, remain approachable as I learn, and leave honest room to grow later.

Writing code is part of how I crystallize my understanding. I like working through concepts and implementation details with an agent, seeing concrete code when it helps, and then often writing the code myself. That is not meant to turn the work into a lesson. It is a collaborative way to keep an intuitive and reliable model of the application rather than offloading that model along with the implementation.

If I am struggling to understand part of Vela, treat that as a possible design signal. Help me step back and inspect the model instead of merely explaining an increasingly complicated implementation.

## The active observatory

During an observation, Vela should make it easy to answer:

1. What is my rig doing right now?
2. Are its devices connected, healthy, and behaving as expected?
3. What does the most recent exposure look like?
4. What is being observed, where is it in the sky, and what result should I expect?
5. What happens next, and when?
6. What details explain the current situation?

"Live" imagery currently means the most recent exposure. Treat it as first-class operational state so Chris can quickly judge framing and image quality. Live stacking may become a separate capability if a concrete need appears, but it is not part of the present capture model.

### Capture runs, not durable sequences

A capture run starts repeated exposures with the requested parameters and continues until Chris stops it. Avoid turning this into a durable, editable sequence, plan, run history, recovery engine, or general workflow state machine before a real observing need demands one.

The server owns an active capture run, so a browser may disconnect and reconnect without ending it. A server crash or restart interrupts the run. That is acceptable: report the interruption truthfully rather than building resumable execution in advance.

### Local network before deployment

Vela is intended to work across the local network, including from a phone near the rig. It may eventually run as a service on `chicks-arch`, but deployment, hosted access, and cloud architecture are not current product work.

Keep a reasonable path to local-network deployment open without prematurely adding containers, service management, authentication platforms, or release machinery. Do not deeply assume every process and device lives on one machine, but do not pave a road Vela does not yet need.

### Responsive by context

Desktop and mobile should share one responsive web application without pretending every surface needs identical workflows.

Desktop is the natural place for broad operation, configuration, and image inspection. A phone is especially valuable while Chris is physically at the rig—for example, checking state while making polar-alignment adjustments. Decide what each workflow needs at its relevant breakpoints rather than merely shrinking the desktop layout.

### Current non-goals

Vela is not currently:

- a complete N.I.N.A. replacement for every astronomer
- a hosted or multi-user cloud platform
- an autonomous guardian responsible for rig safety
- a universal step-by-step planning system
- a third-party plugin ecosystem
- a full calibration, stacking, and image-processing suite

Image acquisition, latest-exposure preview, quality inspection, and artifact organization fit Vela. Deep post-processing belongs in specialized tools unless a later concrete workflow changes that boundary.

## Engineering taste

### Make the critical path read like the workflow

Chris should be able to return months later, read a few dozen lines on the critical path, and understand what happens. Favor explicit flow, strong domain names, small interfaces, and local reasoning.

Sophisticated implementation is warranted for genuinely difficult problems. Isolate it behind a simple interface so the ordinary path does not become a tour of that sophistication.

### Put irregularity in adapters

ALPACA devices, network transport, FITS data, and vendor behavior are natural complexity boundaries. Adapters should absorb wire formats, protocol errors, malformed responses, and device quirks, then expose stable Vela concepts.

An adapter should not know which feature consumes it. A feature should rely on a narrow capability contract rather than importing a concrete adapter.

### Prefer concrete capabilities and strong primitives

Implement today's capability directly. Generalize after repeated use reveals a stable concept. A little temporary duplication is often cheaper than an abstraction based on imagined variation.

At the same time, invest deliberately in primitives that make capabilities composable and removable. The difference is intent: strong composition supports change; speculative product behavior predicts it.

### Use the existing stack coherently

A dependency is useful when it absorbs real boundary complexity or provides a strong primitive. It is harmful when it introduces more concepts than the workflow it supports.

Prefer learning and using the chosen stack coherently over accumulating overlapping frameworks or building machinery because it appears architecturally impressive.

See [CODING_STANDARDS.md](./CODING_STANDARDS.md) for concrete coding defaults.

## Core, extensions, and composition

Vela should trend toward a small, stable, domain-agnostic core with first-party capabilities organized as extensions. This is an architectural direction, not a mandate to build a plugin framework in advance.

The core provides mechanisms that unrelated capabilities genuinely share: composition, lifecycle, messaging, state or persistence primitives, configuration, and observability may belong there as concrete needs emerge. Astronomy behavior and user-facing features usually do not.

Extensions may span the server contracts and interface needed for one vertical capability. Prefer declarative contributions once Vela has a stable contribution concept, with a small imperative escape hatch for cases that do not fit. Do not invent registries for contribution types no feature needs yet.

Composition should remain visible. A small, obvious composition point in each runtime should make it possible to see which first-party capabilities and adapters are active and how their contracts are connected. Avoid a dynamic provider matrix, deeply nested dependency graph, or giant bag of ambient services.

Adapters and extensions should not depend on one another's implementations. Honest, typed contract-level dependencies are acceptable and should be visible at composition. Do not hide real coupling behind an untyped message bus merely to make modules appear independent.

If the extension mechanism makes Vela harder to trace than direct composition, simplify the mechanism.

## State, failure, and physical devices

Persist durable user-created facts and valuable artifacts: rig configuration, preferences, retained captures, artifact metadata, and perhaps recent capture settings. Connection status, command progress, and active capture-run state are observations or ephemeral operations, not automatically durable workflows.

Keep recovery narrow and evidence-based:

- A boundary may retry a known transient transport failure.
- A substantive or uncertain operation should stop rather than enter a generic retry engine.
- After an ambiguous physical write, inspect the device when its adapter exposes a clear and reliable state query.
- Never blindly replay a command whose outcome is unknown.
- If inspection cannot resolve the outcome, explain what is known and ask Chris to decide what happens next.

Distinguish operational preconditions from safety policy. A disconnected camera cannot start an exposure; that is a fact about the operation. High humidity may concern Chris, but Vela should not invent a policy that blocks or parks the rig.

Rig safety remains Chris's responsibility. Vela may show concerning conditions prominently and execute protective behavior Chris explicitly configures, but safety machinery should not dominate the architecture or take unsolicited action.

The interface follows the same standard of honesty. Preserve a last-known view during a connection interruption, mark its age and disconnected state clearly, and reconnect quietly when possible. Never present stale telemetry or imagery as live, and never show an unconfirmed command as successful.

## Working with Chris

Ownership labels describe how Chris keeps knowledge of Vela, not boundaries an agent is forbidden to cross.

### Chris-led areas

Chris generally prefers to write the application and shared domain code himself:

- `apps/server`
- `apps/web`
- `packages/model`

In these areas, begin by exploring the problem and tradeoffs together. Concrete implementation examples are welcome. Let Chris choose what he wants to write, work in small reviewable increments, and help with design, tests, debugging, and review. Implement directly when Chris asks.

### Agent-led areas

Agents generally own the component design workflow and reusable UI package:

- `apps/workshop`
- `packages/ui`

The protocol boundary in `packages/alpaca` has also generally been agent-led. Agents may implement autonomously within an agreed task, while involving Chris in decisions that change product behavior, shared architecture, or public APIs.

### Challenge and then support

Call out speculative scope, unnecessary complexity, or conflict with these principles early. Explain the concrete cost and offer a smaller path. Chris makes the final decision; once the tradeoff is understood and a direction is chosen, support it instead of repeatedly relitigating it.

## Repository map

- `apps/server` — Fastify API, server-owned orchestration, rig configuration, and the trusted boundary around local observatory devices.
- `apps/web` — React and Vite control surface for operating and monitoring Vela.
- `apps/workshop` — source-backed environment for designing and evaluating reusable components.
- `packages/alpaca` — server-side ALPACA protocol, transport, discovery, and normalization boundary.
- `packages/model` — dependency-light contracts shared by the server and browser; it does not own transport or application behavior.
- `packages/ui` — stable UI components, design tokens, themes, and draft components.

Read nearby READMEs and durable design documents before changing a boundary. In particular, `packages/model`, `packages/alpaca`, and `apps/workshop` document the responsibilities they currently own.

## Working in the repository

Linear is available to agents for meaningful planned work, status, and review. Use it when it improves coordination rather than creating process for its own sake. The main project is **Vela - Main Development**.

Use the smallest verification that proves a change. Prefer focused tests and scoped builds over broad checks by habit; run wider checks when the change crosses workspace boundaries or Chris asks for them. See [CODING_STANDARDS.md](./CODING_STANDARDS.md) for current commands and conventions.

Treat these principles as strong defaults. When one conflicts with the concrete task, make the tension visible and work through it with Chris rather than following the document mechanically.
