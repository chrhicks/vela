# Vela Component Workshop

The workshop is a local, source-backed environment for designing real components in `@vela/ui`. It does not replace Vela's current theme or automatically export, promote, or adopt components.

## Run it

```sh
pnpm dev:workshop
```

Open `http://127.0.0.1:5174` for the focused workbench or `http://127.0.0.1:5174/gallery` for library-wide evaluation. Component and specimen source edits refresh through Vite HMR.

## Current workshop

- Stable Button, IconButton, Input, Select, Checkbox, Badge, Tabs, NavigationBar, and Panel/Card components
- A stable NavigationBar anatomy specimen and fixture-backed observatory navigation example, sharing rig context, page links, and capture activity rendering
- A fixture-backed Rig overview product example for evaluating clickable Rig summaries and kind-specific live device cards
- A fixture-backed observation-readiness product example for evaluating the Start Observing transition, Rig-level connection preparation, and honest partial or uncertain outcomes
- A polar-alignment adjustment product sketch with phone/desktop layouts, illustrative large-error, near-aligned and outside-image fixtures, and a three-position starting/measurement preview. Proposed image inspection starts with a padded fit of the frame reference and correction target (4′ minimum field); deliberate 1′ fine, full-frame and 100% inspection remain available, including same-exposure enlargement and baseline no-solution. Angular geometry is illustrative on the bundled simulator image; retry/age snapshots are explicit. Fit-both is pending design review, not approved production appearance. It does not control hardware or measure alignment.
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
- Focused contrast diagnostics and a literal-color source audit
- Stable component/specimen URLs and Copy Context
- Automatic ignored session recovery
- Explicit tracked design-profile Save and Save As

Gallery cards intentionally contain live component previews and a separate Open action. The gallery is for judging cohesion; the workbench remains the place to adjust props, contexts, responsive width, and theme values for one component.

## Primitive and product-example specimens

A reusable component starts with a primitive-focused specimen that shows what the component owns. A second specimen may demonstrate a concrete Vela workflow when that real context helps evaluate what the primitive can enable.

Product examples are design references, not application components. They keep feature copy, fixtures, domain composition, and illustrations in non-exported specimen source, with layout styles in colocated `*.specimen.css`. The web application later imports the primitive and implements the feature from its own state and markup rather than importing or copying the example wholesale.

This pattern is visible under Dialog as **Primitive anatomy** and **Rig discovery · Product example**. See the operations guide for the ownership and extraction rules.

## Persistence

The Vite development server exposes a local-only persistence boundary:

- `.local/session.json` is ignored recovery state and updates automatically.
- `designs/*.json` contains tracked named design profiles and changes only through Save or Save As.
- Built-in `Vela UI Default` and `Vela Current` profiles are read-only references.
- A named profile whose baseline fingerprint differs from the current package default is identified as baseline drift; it is never rebased automatically.

The boundary accepts only the fixed session and profile routes, validates payload shape, restricts profile IDs, limits request size, and writes atomically. It is not a general filesystem API.

## Source ownership

```text
packages/ui/src/themes/       token contract and defaults
packages/ui/src/components/   stable React components and specimens
packages/ui/src/drafts/       draft components, specimens, and specimen-local styles
apps/workshop/src/            workshop experience
apps/workshop/designs/        named tracked profiles
apps/workshop/.local/         ignored recovery state
```

All current components, including Dialog and SkyPath, are exported from the `@vela/ui` root. The `@vela/ui/drafts` component API is currently empty. SkyPath’s stable primitive specimen and the draft target-framing product example share non-exported, invented sample paths and optional horizon states; no private observing-site data is bundled. SkyPath renders supplied coordinates and does not calculate ephemerides or load observing-site data.

See the [operations guide](../../docs/component-workshop-operations.md) for adding drafts, authoring interactive specimens, persistence, targeted browser proof, manual promotion, and later one-at-a-time Vela adoption.
