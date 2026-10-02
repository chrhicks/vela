# Vela Workshop

The workshop is a local, source-backed place to compose and try Vela features. Its secondary Design system area retains the component workbench, gallery, and theme tools. Nothing is automatically promoted or adopted into the application.

## Run it

```sh
pnpm dev:workshop
```

Open `http://127.0.0.1:5174` for the feature shelf, `/features/framing` for the first feature exploration, or `/design-system` for the existing component and theme workbench. `/design-system/gallery` opens paired component previews. Legacy `/?component=...&specimen=...` links and `/gallery` still work. Source edits refresh through Vite HMR.

For an isolated runtime on another port, launch it explicitly:

```sh
pnpm --filter @vela/workshop exec vite --host 127.0.0.1 --port 5184 --strictPort
WORKSHOP_PORT=5184 pnpm --filter @vela/workshop test:browser
```

`WORKSHOP_PORT` configures the browser suite's base URL and server launch together (default 5174, valid range 1–65535). Strict port selection prevents testing a silently reassigned server. Use an available port and verify the preview belongs to your checkout.

## Feature authoring

The structure is **Feature → Design → Scenario**:

- A feature groups a capability or change, such as Framing.
- A design supplies a React composition and a sentence explaining its intent.
- A scenario supplies typed starting state and optional “try this” guidance for that composition.

Copy [the starter](src/feature-workspace/starter.feature.tsx) to `src/features/<feature-id>.feature.tsx` for a new feature. Refine an existing design in place, add a design for a competing approach, or add a scenario for a different situation. The starter stays outside discovery but participates in TypeScript checks. [Framing](src/features/framing/framing.feature.tsx) is the working example; the [authoring guide](../../docs/component-workshop-operations.md#author-a-feature-exploration) covers these choices, reset behavior, stable URLs, and verification.

Only Framing has moved into the feature workspace initially. It reuses a narrow, non-public source adapter to its existing specimen so the approved composition remains recognizable. Other product examples remain accessible in Design system with their existing status. New feature compositions belong to the workshop; this pilot adapter does not create a public feature API in `@vela/ui`.

The feature workspace uses Fieldroom light/dark and a Width menu: Fit, Phone (390px), and Desktop (1280px), with custom widths supported by URL. Preview width changes an element's size; use container queries for responsive compositions. A copied link records the feature, design, scenario, appearance, and actual preview width. Reset and scenario changes remount the preview from its fixture. Interaction progress is temporary; returning to a feature can recover its last selection, while an explicit shared URL wins over local selections. The authoring guide includes [responsive sizing](../../docs/component-workshop-operations.md#responsive-preview-sizing) and a [thumbnail capture recipe](../../docs/component-workshop-operations.md#capture-a-feature-thumbnail).

## Existing design-system library

- A [local retained-image preview-color comparison](preview-color/README.md): current rendering versus bounded display-only background subtraction, with fit/native/thumbnail scales and explicit source hashes. Workshop only; generated private fixtures stay ignored, with no production rendering or archive changes.
- Stable Button, IconButton, Input, Select, Checkbox, Badge, Tabs, NavigationBar, and Panel/Card components
- A stable NavigationBar anatomy specimen and fixture-backed observatory navigation example, sharing rig context, page links, and capture activity rendering
- A fixture-backed Rig overview product example for evaluating clickable Rig summaries and kind-specific live device cards
- A fixture-backed observation-readiness product example for evaluating the Start Observing transition, Rig-level connection preparation, and honest partial or uncertain outcomes
- A polar-alignment adjustment product sketch with phone/desktop layouts, illustrative large-error, near-aligned and outside-image fixtures, and a three-position starting/measurement preview. Chris approved this inspection design on September 21: padded fit of the frame reference and correction target (4′ minimum field), deliberate 1′ fine, full-frame and 100% inspection, including same-exposure enlargement and baseline no-solution. Angular geometry is illustrative on the bundled simulator image; retry/age snapshots are explicit. It does not control hardware or measure alignment; production delivery status is maintained in [the observing index](../../docs/observing/README.md).
- An Observe autofocus product sketch with a live V-curve: Start plays simulated shorts so each (position, HFR) point lands on the graph, with start, current, and fitted-minimum readout. A window that cannot fit stays on setup with the command disabled. It does not command a focuser or present unread backlash compensation as a device fact.
- An Observe hub and Capture product sketch with single-exposure controls, retained latest-image inspection at fit/100% scale, and empty/progress/stopped/failed/disconnected states. Its accelerated local preview uses a fixed simulator image and sends no device commands.
- A draft Capture-run sketch with optional repetition, immediate stop request, completed-image count, Observe continuity and retained-image inspection. Procedural exposure fixtures vary star appearance, haze and occasional streaks only when each accelerated exposure completes; no server runs or device commands.
- CHI-193 extends that Capture-run sketch with **Interrupt camera reads** during an exposure: the previous image/count stay put, progress becomes unavailable, and reads recover after 12 seconds to receive the same exposure. Stop stays available; the inspector's **Simulated camera stop result** selects confirmed cleanup or an explicit failed/unconfirmed stop. `observation-interrupted` snapshots have **Play read recovery**; these device-read states are distinct from the existing browser/server `disconnected` snapshot. This is workshop design pending review, not production adoption.
- An imaging-camera setup sketch on Observe with explicit remembered choice and missing, changed, offline and busy states; local fixtures only.
- A stable Dialog with both primitive anatomy and a fixture-backed Rig discovery product example
- A simulator-control product sketch with coarse/fine mount nudges, exact offset setup, clear/obscured camera and preset reset; local interactive fixtures only, with no simulator service connected
- A draft visual target-selection and framing sketch with locally bundled reference photographs, instant sample search, illustrative sky paths, a movable fixed-orientation camera frame, and simulated slew/check/adjust states. Its Through the night sidebar expands into an overhead sky view with shared time and elevation-margin controls. Optional synthetic horizon profiles demonstrate complete, incomplete and provisional coverage. A sample Moon phase marker follows the selected time with illumination, spherical target separation and a below-horizon state. It does not calculate real visibility or control devices.
- A stable SkyPath primitive for target paths, time selection, optional local horizons, and sample Moon context, with a fixture-backed primitive specimen
- An approved automatic-centering product example with normal convergence, a flip followed by fresh-solve recovery, repeated worsening, and Stop. Its stable WorkingIndicator primitive preserves the working shimmer and static reduced-motion treatment. Production adopts its status, offset and progress hierarchy around real survey imagery; the example photographs, predicted flip and simulated measurements remain workshop-only. Exposure waits use real-time 20 seconds with accelerated non-exposure stages.
- Auto-discovered colocated specimens
- One primitive-focused specimen per component, with additional product examples only for concrete compositions that prop controls cannot express
- A searchable gallery with paired light and dark previews
- Fixed isolated, form/settings, toolbar/action-row, and card/data-list compositions built from the real components
- Generated and individually adjustable neutral, accent, positive, warning, and danger OKLCH ramps
- Editable paired light and dark semantic mappings
- Typography, geometry, density, prop, context, and viewport controls
- Baseline comparison
- Focused contrast diagnostics for resolved hex and OKLCH colors, including action states, warning/error surfaces, focus and control edges, plus a literal-color source audit
- Stable component/specimen URLs and Copy Context
- Automatic ignored session recovery
- Explicit tracked design-profile Save and Save As

Design-system gallery cards intentionally contain live component previews and a separate Open action. The gallery is for judging cohesion; the component workbench remains the place to adjust props, contexts, responsive width, and theme values for one component.

## Primitive and product-example specimens

A reusable component starts with a primitive-focused specimen that shows what the component owns. A second specimen may demonstrate a concrete Vela workflow when that real context helps evaluate what the primitive can enable.

Product examples are design references, not application components. They keep feature copy, fixtures, domain composition, and illustrations in non-exported specimen source, with layout styles in colocated `*.specimen.css`. The web application later imports the primitive and implements the feature from its own state and markup rather than importing or copying the example wholesale.

This pattern is visible under Dialog as **Primitive anatomy** and **Rig discovery · Product example**. See the operations guide for the ownership and extraction rules.

## Persistence

The feature workspace remembers preview selections locally in the browser; it does not persist interactive simulation state. The Design system's Vite development server exposes a local-only persistence boundary:

- `.local/session.json` is ignored recovery state and updates automatically.
- `designs/*.json` contains tracked named design profiles and changes only through Save or Save As.
- Built-in `Fieldroom`, `Vela UI Default`, and `Vela Current` profiles are read-only references. Fresh sessions start in Fieldroom/light; recovered sessions keep their selected profile and mode.
- A named profile whose baseline fingerprint differs from the current package default is identified as baseline drift; it is never rebased automatically.

The boundary accepts only the fixed session and profile routes, validates payload shape, restricts profile IDs, limits request size, and writes atomically. It is not a general filesystem API.

## Source ownership

```text
packages/ui/src/themes/       token contract and defaults
packages/ui/src/components/   stable React components and specimens
packages/ui/src/drafts/       draft components, specimens, and specimen-local styles
apps/workshop/src/            workshop experience
apps/workshop/src/features/   feature declarations, compositions, and local fixtures
apps/workshop/src/feature-workspace/ feature shell, authoring contract, and starter
apps/workshop/designs/        named tracked profiles
apps/workshop/.local/         ignored recovery state
```

All current components, including Dialog and SkyPath, are exported from the `@vela/ui` root. The `@vela/ui/drafts` component API is currently empty. SkyPath’s stable primitive specimen and the draft target-framing product example share non-exported, invented sample paths and optional horizon states; no private observing-site data is bundled. SkyPath renders supplied coordinates and does not calculate ephemerides or load observing-site data.

See the [operations guide](../../docs/component-workshop-operations.md) for adding drafts, authoring interactive specimens, persistence, targeted browser proof, manual promotion, and later one-at-a-time Vela adoption.

## Fieldroom and Appearance

Fieldroom is the shared/workshop design authority. Production application
adoption is tracked separately in [the adoption plan](../../docs/fieldroom-adoption.md).
Use Fieldroom in the matching light or dark mode at density 1 for reference
comparisons. The two older profiles remain named token references; shared
component changes are not a promise to freeze their historical rendering.

The theme inspector distinguishes exact per-mode color overrides from generated
ramps. Exact colors have a color picker and **Use generated** action. A semantic
ramp selector is disabled while that color has an exact override; deleting an
override restores its generated mapping for the current mode only. Body and
heading families can be selected independently.

Open `/?component=appearance&specimen=appearance-primitive&profile=fieldroom`
for the controlled, non-modal Appearance specimen. Its controls exercise System
resolving light/dark, explicit Light/Dark, and saved/visit-only copy. The selected
radio receives focus, arrows change selection without closing, and Escape or
Close returns focus to the trigger. Tab can leave the panel; outside interaction
dismisses without stealing focus or consuming the action. Preview mode remains
explicitly controlled by the workshop, independent of this mocked preference.
The shared component does not read storage or browser color preferences.

Focused checks:

```sh
pnpm exec vitest run apps/workshop/src/diagnostics.test.ts
pnpm --filter @vela/workshop exec playwright test tests/Appearance.e2e.ts
```
