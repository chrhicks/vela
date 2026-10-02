# Workshop Operations Guide

This guide covers feature explorations in the workshop and the secondary Design system workflow for designing, validating, promoting, and adopting components from `@vela/ui`. The original component-workshop decisions remain in [Component Workshop Decision Record](component-workshop.md).

The workshop is a local developer tool. None of the procedures below publish a package, change Vela's default theme, apply a named design profile to Vela, or adopt a component into the Vela application automatically.

Follow [AGENTS.md](../AGENTS.md#working-with-chris) for collaboration, authorization, and review. An agreed implementation scope can include authoring, promotion, and adoption without separate permission for each operation; exploratory workshop work alone does not authorize application adoption or changes to global defaults.

## Application visual authority

The approved workshop specimen and profile define the design; `@vela/ui` owns
its shared implementation, and `apps/web` adopts it. **Fieldroom** is the shared
and workshop authority; fresh workshop sessions use Fieldroom/light. Production
application adoption is in progress under the [Fieldroom adoption plan](fieldroom-adoption.md);
the application shell retains its previous profile until that application slice.
`DEFAULT_PROFILE` (**Vela UI Default**) and `VELA_CURRENT_PROFILE` (**Vela Current**)
remain named token references. The archived screenshots preserve their previous
appearance; shared components do not maintain a second legacy stylesheet.

For Fieldroom comparisons, select Fieldroom, the reference's light or dark mode,
density 1, and no unsaved profile overrides. Match state, content width, and
reference crop. An existing recovered session may retain a different profile.
The workshop's surrounding editor is not part of the specimen's design.

Keep approved shared geometry and styling in `@vela/ui`; app feature styles may
compose the primitives, but must preserve the corresponding specimen's visual
choices. Check rendered borders, corners, typography, and spacing in both
runtimes—importing the same component does not prove they use the same theme.
Deliberate feature differences need a concrete reason, such as operational
state or different content, rather than an app-only restyling.

Load shared UI styles before importing feature modules and their composition
styles in each runtime. Equal-specificity rules depend on that order: for
example, a specimen's composition must not be displaced by a later shared rule.
Approved 46px text controls and 44px icon targets belong in shared primitives.

Workshop scratch changes and alternate profiles remain exploratory until
explicitly adopted; the application does not read workshop session files.

## Workspace boundaries

```text
apps/workshop/
  src/                         visual evaluation and workflow UI
  src/features/                feature declarations, compositions, and local fixtures
  src/feature-workspace/       feature shell, typed authoring contract, and starter
  designs/*.json               explicitly saved, tracked design profiles
  .local/session.json          ignored automatic recovery state

packages/ui/src/
  components/                  stable component source and specimens
  drafts/                      experimental component source and specimens
  themes/                      token contract, defaults, resolution, validation
  styles.css                   shared component styles using Vela tokens
  **/*.specimen.css            non-exported specimen-only styling
```

`@vela/ui` has two intentionally different component surfaces:

- `@vela/ui` is the stable API. It currently exports themes and promoted components.
- `@vela/ui/drafts` is the explicit experimental API used by the workshop. Drafts must not leak through the stable root.

The Design system discovers `*.specimen.tsx` files from both `components/` and `drafts/`. Their directory determines the Stable or Draft label shown in the library and gallery. The feature workspace separately discovers `src/features/**/*.feature.tsx`; every discovered file exports a named `feature` declaration.

Only Framing is initially available in the feature workspace. Its declaration uses a narrow source adapter to the existing framing specimen rather than recreating the approved composition. That adapter is not exported from the UI package API. Other examples remain in Design system without an automatic promotion, archival, or adoption change. New feature compositions and fixtures belong in `apps/workshop/src/features`.

## Artifact terminology

- **Feature:** a capability or change being explored, containing one or more designs. Its `current` or `past` collection controls shelf placement, not approval or production status.
- **Design:** a React composition, intent, and scenarios for one approach to the feature. A single design needs no comparison selector.
- **Scenario:** named initial conditions for trying a design. Subsequent clicks and progress are local interaction state, not additional scenarios by default.
- **Working session:** ignored recovery data for the active component, specimen, profile, mode, context, viewport, density, props, comparison state, and unsaved theme overrides.
- **Design profile:** explicitly saved, tracked JSON containing token overrides plus baseline identity and fingerprint.
- **Draft component:** real React source under `packages/ui/src/drafts`, exported only from `@vela/ui/drafts`.
- **Stable component:** explicitly promoted React source under `packages/ui/src/components`, exported from `@vela/ui`.
- **Specimen:** a curated source-backed scenario colocated with its component. Interactive states belong in prop controls unless a materially different scenario proves the need for another specimen. A product-example specimen may compose a real Vela workflow as a non-exported design reference; it does not become an application component.

## Run and verify the workshop

```sh
pnpm dev:workshop
```

Open:

- `http://127.0.0.1:5174/` or `/features` for the feature shelf.
- `http://127.0.0.1:5174/features/framing` for the framing exploration.
- `http://127.0.0.1:5174/design-system` for the component and theme workbench.
- `http://127.0.0.1:5174/design-system/gallery` for paired light/dark library evaluation.

Legacy `/?component=...&specimen=...` and `/gallery` links remain supported.

Source and specimen edits refresh through Vite HMR. The development server binds to `127.0.0.1` by default; its local persistence API exposes only the fixed session and profile routes.

For another checkout or a busy default port, choose an available port and launch explicitly:

```sh
pnpm --filter @vela/workshop exec vite --host 127.0.0.1 --port 5184 --strictPort
WORKSHOP_PORT=5184 pnpm --filter @vela/workshop test:browser
```

The first command runs the preview until stopped. The second can reuse that runtime, or start its own server on the same configured port. `WORKSHOP_PORT` defaults to 5174 and accepts integers from 1 through 65535; it sets both Playwright's base URL and its server command. Strict port selection makes a collision fail instead of silently moving the server. Verify any reused runtime belongs to the checkout under review. For a focused test, append its test filename to `test:browser`.

If the browser runs on another machine, use `--host 0.0.0.0` for the preview and navigate to the development machine's reachable address, or use the browser tool's environment-port target. Loopback-only reachability does not prove that a remote preview can connect. Keep a review runtime running while its link is in use; stopping an isolated trial server leaves its browser tab disconnected.

Choose focused tests and builds for the affected boundary using [CODING_STANDARDS.md](../CODING_STANDARDS.md#focused-verification), then check the diff. For example, a UI component change may use:

```sh
pnpm --filter @vela/ui build
git diff --check
```

Run the relevant existing test files for shared artifact validation, local persistence, token resolution, or stable-versus-draft exports when those behaviors are affected. Full `pnpm test` and `pnpm build` are appropriate when the change crosses enough workspace boundaries to warrant them, not as a default for every specimen edit.

Dialog and Appearance behavior also have focused Chromium suites because modal focus, dismissal, and restoration depend on browser behavior. Install its browser once, then run it with:

```sh
pnpm --filter @vela/workshop exec playwright install chromium
pnpm --filter @vela/workshop test:browser
```

The suite starts the workshop itself and checks passive gallery previews, modal focus containment and restoration, dismissal, simulated responsive and comparison canvases, and asynchronous specimen state updates. Appearance checks cover radio selection, non-modal focus, outside actions, phone bounds, reduced motion, and saved/visit-only copy.

## Author a feature exploration

Use the smallest change that represents the requested work:

| Work | Authoring action |
| --- | --- |
| Explore a new capability or change | Copy the canonical starter and assign a new feature identity |
| Refine the approach already under discussion | Edit that design in place |
| Compare a competing layout or interaction | Add a design under the existing feature; reuse or copy its composition as appropriate |
| Try another starting condition or simulated outcome | Add a scenario to the existing design |

Start from [starter.feature.tsx](../apps/workshop/src/feature-workspace/starter.feature.tsx), copying it to `apps/workshop/src/features/<feature-id>.feature.tsx`. This destination keeps its import path valid. Supporting components, assets, and fixtures can be colocated in a feature directory; adjust relative imports when nesting the declaration. The starter is compiled but sits outside automatic discovery. It shows an ordinary React component initializing local state from `initialState`, then updating that state through a button.

Replace the starter's IDs, labels, intent, content, and thumbnail. Its temporary placeholder is allowed while authoring; capture an actual preview and replace it before presenting the feature. Follow [the capture recipe](#capture-a-feature-thumbnail). [The Framing declaration](../apps/workshop/src/features/framing/framing.feature.tsx) is the first real example.

`defineDesign<State>` ties scenario fixtures to the component's `initialState` prop. `defineFeature` groups the resulting designs. Keep these declarations small; layout, interactions, and feature-specific simulation logic stay in ordinary React components. The workshop does not interpret the meaning of fixture fields.

Authoring rules:

- Export `const feature = defineFeature(...)` from each discovered `*.feature.tsx` file. Supporting files should not use that suffix.
- Use stable kebab-case IDs. Feature IDs are unique across the catalog; design IDs are unique within their feature; scenario IDs are unique within their design. Change labels freely without breaking links.
- Declare `defaultDesign` and `defaultScenario` explicitly, each matching a real entry. Every feature needs a design, and every design needs a scenario.
- Write a short `intent` explaining what the design explores. A scenario's optional `description` explains its starting situation; `tryThis` suggests an interaction worth evaluating. These notes belong in the preview's details, not permanent surrounding chrome.
- Treat `initialState` as an immutable fixture. Initialize local state from it and replace changed objects rather than mutating fixture data. Reset and design/scenario switches remount the preview; do not retain simulation state in module globals or browser storage.
- Clean up timers, subscriptions, and other effects on unmount so changing scenarios or resetting cannot leave old work running. Simulate locally; feature previews do not command observatory hardware.
- Preserve believable page context when exploring changes to an existing feature. Reuse stable UI primitives, keep composition styles local, and avoid recreating the entire app's service graph.

TypeScript catches incompatible fixture inputs. Catalog validation reports source filename, declaration path, and the problem for duplicate IDs, empty required text or lists, missing defaults, and missing named exports. The catalog publishes no partial list when those authoring errors exist. Fix the indicated declaration and let HMR reload it.

### Responsive preview sizing

The Width menu offers Fit, Phone (390px), and Desktop (1280px). Custom widths from 320 through 1920 remain available through `viewport` in the URL. The preview is an element inside the workshop, not an iframe or resized browser viewport: `@media (max-width: ...)` measures the outer browser and will not respond to selecting Phone on a wide desktop.

The workshop provides an inline-size query container around the preview. Use container queries on the composition inside it:

```css
.my-feature-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
}

@container (max-width: 640px) {
  .my-feature-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

Keep selectors feature-local. Avoid viewport-sized widths such as `100vw` for preview content; use the available container width. Fit follows available space within the supported width range. At narrow browser sizes the stage removes horizontal padding; a deliberately selected width larger than the available space remains that width and scrolls horizontally. Choosing Desktop on a phone therefore inspects a desktop layout; choosing Fit inspects the layout that fits the phone.

### Capture a feature thumbnail

1. Open the new feature directly with explicit design, scenario, light/dark mode, and `viewport=1024`. Use a browser wide enough to show the entire preview. Choose a representative starting state, close menus and details, and reset any exploratory interaction.
2. Use the browser tools available in the session. Prefer T3 preview tools when exposed: check preview status, open it if necessary, then navigate and inspect. Follow the session's browser-tool rules for any fallback; no new capture tool or generator is needed.
3. Wait for the feature's images and fonts to finish loading before capture. Confirm images have loaded successfully, rather than capturing empty placeholders or assuming a fixed delay is sufficient.
4. Capture the preview surface using an element screenshot or a crop of the visible preview, excluding workshop controls. If cropping from DOM bounds, compare the saved image's pixel dimensions with the browser's CSS viewport dimensions and scale the crop coordinates accordingly; they may differ. A full-page screenshot does not necessarily include content hidden inside an inner scrolling element. Inspect the intended crop, scroll deliberately if needed, and capture the visible composition rather than stitching hidden content into an invented layout.
5. Save the image beside the feature and reference it with `new URL('./thumbnail.png', import.meta.url).href`, or save under `apps/workshop/public/` and use its root-relative URL. Write descriptive alt text.
6. Inspect the actual shelf card. Thumbnails use a centered cover crop in a 190px-high area whose width changes with the shelf layout; very wide, short captures can lose content at the sides. Choose a representative crop with room around the important content. Reload the shelf if a previously missing image remains broken after creating the file.

For a saved screenshot, an installed image tool is enough; no capture dependency belongs in the feature. For example, ImageMagick crops with `magick capture.png -crop WIDTHxHEIGHT+X+Y +repage thumbnail.png`, using the measured image-pixel dimensions and offsets in place of the uppercase placeholders.

### Feature links and reset

A complete preview URL looks like:

```text
/features/framing?design=sky-context&scenario=frame-checked&mode=light&viewport=1024
```

`mode` is `light` or `dark`; `viewport` is `fit` or a pixel width from 320 through 1920. The Width menu provides Fit, Phone (390px), and Desktop (1280px), while explicit URLs can select any supported custom width. Copy link resolves Fit to the actual preview width so another browser opens the intended layout. Links reproduce starting conditions, not an interaction session halfway through a simulation.

The toolbar labels the selected starting preset **Start from**. Choosing a preset jumps the mock to that configuration, including choosing the same preset again after interacting. It remains selected while the preview is explored; it does not describe the current interaction state.

A bare feature URL can recover the last local selection. A full explicit URL takes priority over recovered choices. Reset returns the current scenario to its starting fixture. Theme and viewport choices are workshop presentation settings, separate from scenario data.

For a review handoff, use Copy link to provide a direct link to the particular design, starting scenario, appearance, and width worth trying. Name what to inspect or do from that starting point instead of making Chris reconstruct the configuration.

### Prove the authoring path

Open the actual preview, try its suggested interactions, switch scenarios, and reset after making changes. Check relevant desktop and phone widths and light/dark appearance. Open a copied link and confirm it restores the intended starting view. Ensure effects stop when leaving a preview. Run workshop TypeScript checks and focused tests appropriate to the changed behavior.

Prove this workflow with the first feature before expanding migration. Adding the next feature should require a small declaration and ordinary React composition, without introducing a generator, custom agent tool, or a new framework layer. Follow the independent verification and browser acceptance workflow in [AGENTS.md](../AGENTS.md#verification-browser-review-and-merge) before adopting user-facing changes.

## Add a draft component

1. Add `packages/ui/src/drafts/ComponentName.tsx`.
2. Give the public component semantic props such as `tone`, `size`, or `emphasis`. Keep raw colors and arbitrary geometry in the token system.
3. Style the reusable component in `packages/ui/src/styles.css` using semantic or intentional component variables. Keep product-example layout in a colocated `*.specimen.css` imported only by that specimen; example selectors must not leak into the shared stylesheet.
4. Export it only from `packages/ui/src/drafts/index.ts`.
5. Add one primary `ComponentName.specimen.tsx` beside it.
6. Open the gallery and confirm the component appears as Draft in paired light and dark modes.
7. Open it in the workbench and exercise props, density, contexts, responsive widths, comparison, profiles, and Copy Context.
8. Add another specimen only when a concrete scenario cannot be represented adequately by ordinary prop controls or fixed compositions. Name real workflow compositions as product examples so their reference-only role stays visible.

Do not add a draft component to `packages/ui/src/index.ts` or `packages/ui/src/components/index.ts`.

## Author an interactive specimen

A specimen exports one `ComponentSpecimen` object. Its renderer receives current primitive props and an optional change callback:

```tsx
render: (props, onPropsChange) => (
  <Example
    value={String(props.value)}
    onValueChange={(value) => onPropsChange?.({ value })}
  />
)
```

Use the callback for interactions that should update the inspector, stable URL, session recovery, and Copy Context. Gallery previews omit the callback, so they remain self-contained and never mutate the active workbench.

For time-based workflows, judge how feedback unfolds at a representative pace, not only the final state. A recording can support review; the running specimen is the reference for interaction timing and feel.

## Pair primitive anatomy with product examples

A component begins with a primitive-focused specimen that makes its reusable contract understandable without depending on a Vela feature. Name it for what it demonstrates—for example, **Primitive anatomy**—rather than using relative labels such as Basic or Advanced.

Add a product-example specimen when a real workflow materially improves visual judgment or exposes missing primitive behavior. Name it visibly—for example, **Rig discovery · Product example**—and preserve these boundaries:

- The primitive owns reusable structure, interaction behavior, accessibility, responsive mechanics, and shared token-based styling.
- The product example owns feature copy, fixture state, workflow transitions, domain rows, illustrations, and composition.
- Product-example TSX and `*.specimen.css` remain non-exported design references. Their selectors must not enter `packages/ui/src/styles.css`.
- `apps/web` imports the primitive and composes the production feature from its own state and markup. It must not import or copy the example as a disguised feature component.
- A graphic used by one example remains specimen- or feature-owned. Create a shared icon or illustration surface only after concrete reuse proves a stable concept.
- Do not extract candidate cards, rows, notices, empty states, tags, or similar components merely because one polished example contains them. Promote a new primitive after repeated use reveals a durable contract.

The contrast is intentional: the primitive specimen explains **what the component is**, while the product example demonstrates **what it can enable**.

## Work with profiles and session recovery

Ordinary Design system workbench changes save automatically to `apps/workshop/.local/session.json`. This is recovery state and remains ignored by Git. Feature preview selections use separate browser-local recovery and do not persist simulation progress.

Theme adjustments remain in `unsavedOverrides` until Save or Save As is chosen:

- **Save** deliberately updates the selected tracked profile.
- **Save As** creates or replaces a named profile under `apps/workshop/designs/`.
- Read-only `Fieldroom`, `Vela UI Default`, and `Vela Current` profiles cannot be overwritten.
- A fingerprint mismatch is shown as baseline drift. The workshop never rebases a profile automatically.

The local server validates schema version, IDs, primitive props, modes, contexts, viewport bounds, reference ramps, semantic mappings, and theme override keys. The editor shows explicit per-mode colors separately from ramps; Use generated removes an exact color for that mode. Contrast diagnostics inspect the resolved colors, including exact hex values. Writes are size-limited and atomic. It is not a general filesystem API.

## Use stable URLs and Copy Context

The Design system workbench URL records component, specimen, profile, mode, context, viewport, and controlled specimen props. Paste that URL to reopen the same visual scenario. Feature previews use the separate [feature link contract](#feature-links-and-reset).

Copy Context adds density, baseline identity and fingerprint, plus unsaved overrides. Use it when asking for a source change so the exact state can be inspected and reproduced.

## Targeted browser checklist

Choose from these checks according to the changed behavior. Exercise the component and affected shared behavior; expand to the whole gallery when shared tokens, discovery, or composition warrant it. Promotions also include the discovery, export, and representative rendering proof below. Keep evidence with the PR or corresponding Linear issue, and automate behavior that genuinely depends on a browser rather than every visual state.

- **Discovery:** Load `/gallery` afresh, check console errors, and confirm affected components appear with the correct Stable or Draft label.
- **Appearance:** Inspect the primitive specimen and relevant product examples in light and dark modes, isolated and in a representative composition. For app comparisons, use the [application visual authority](#application-visual-authority) settings. Keep product-example styles specimen-local.
- **Interaction:** Exercise the relevant semantic props and direct interactions, including how ongoing work unfolds. Check inspector, stable URL, session state, and Copy Context updates where affected.
- **Responsive behavior:** Inspect the widths the workflow needs, including phone and dark-field use where relevant. Use density and baseline comparison when they help expose a changed layout or token behavior.
- **Diagnostics and recovery:** Use contrast and literal-color diagnostics for styling changes; reload the stable URL when session recovery or controlled props change.
- **Focused proof:** Run the affected tests and builds, relevant workshop browser tests, and `git diff --check`. Stop once the necessary evidence is established unless a new concern requires more checks.

## Manually promote a component

Promotion makes a draft part of the stable API. Carry it out within the agreed implementation scope and preserve an inspectable source diff; exploratory draft work alone does not authorize promotion.

Before promotion, confirm:

- Public props are intentional and semantic.
- Representative specimens exist.
- Paired light and dark rendering is coherent.
- The component uses the shared token contract.
- Relevant focused tests and builds pass.

Then:

1. Move `ComponentName.tsx` and its specimens from `drafts/` to `components/`.
2. Update specimen imports and any draft consumers to use the stable component boundary.
3. Remove the component export from `packages/ui/src/drafts/index.ts`.
4. Add the component export to `packages/ui/src/components/index.ts`; the stable root re-exports that boundary.
5. Confirm workshop discovery labels the component Stable and retains its stable specimen URL.
6. Add or update an export-boundary test proving the stable root contains the component and the draft surface does not.
7. Run the relevant targeted browser checks and non-browser proof.
8. Review the final diff for unrelated adoption, profile, or default-theme changes.
9. Commit the promotion as a meaningful, explicit change.

## Adopt stable components in Vela

Promotion makes a component available; adoption uses it in the agreed feature. Keep adoption incremental and limited to real use sites that scope needs.

1. Run and visually inspect the approved product example at the relevant states, pace, and widths before implementation. Use the [application visual authority](#application-visual-authority) settings to compare like with like.
2. Import stable primitives from `@vela/ui`. Compose the feature from web-owned state, copy, domain markup, and assets, following the [primitive and product-example boundaries](#pair-primitive-anatomy-with-product-examples). Promote a new primitive when concrete reuse establishes a useful contract.
3. Use the application's explicitly adopted profile and existing `@vela/ui/styles.css` entry point; follow the Fieldroom plan while that adoption is in progress. Keep shared style loading ahead of feature composition styles; resolve missing tokens at their owning boundary rather than adding a parallel theme adapter.
4. Compare the implemented feature with the running specimen. Preserve its hierarchy, typography, borders, artwork, and interaction feel while keeping wording honest for real operational states. Verify the changed behavior in the actual application context.
5. Prepare the running product and concrete acceptance scenarios through the [delivery workflow](../AGENTS.md#verification-browser-review-and-merge).

Material design departures or global-theme changes outside the agreed scope return to alignment.
