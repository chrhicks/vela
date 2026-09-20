# Component Workshop Operations Guide

This guide covers designing, validating, promoting, and adopting components from `@vela/ui`. The original product and architecture decisions remain in [Component Workshop Decision Record](component-workshop.md).

The workshop is a local developer tool. None of the procedures below publish a package, change Vela's default theme, apply a named design profile to Vela, or adopt a component into the Vela application automatically.

Follow [AGENTS.md](../AGENTS.md#working-with-chris) for collaboration, authorization, and review. An agreed implementation scope can include authoring, promotion, and adoption without separate permission for each operation; exploratory workshop work alone does not authorize application adoption or changes to global defaults.

## Application visual authority

The approved workshop specimen and profile define the design; `@vela/ui` owns
its shared implementation, and `apps/web` adopts it. The application's adopted
profile is `VELA_CURRENT_PROFILE` (**Vela Current**) from `@vela/ui/themes`.
The app shell and a fresh workshop session both select it. `DEFAULT_PROFILE`
(**Vela UI Default**) remains the library baseline for comparison, not the
application's active theme.

When comparing a specimen with the app, use Vela Current, dark mode, density 1,
and no unsaved profile overrides. Match the relevant state and content width.
The workshop's surrounding editor is not part of the specimen's design.

Keep approved shared geometry and styling in `@vela/ui`; app feature styles may
compose the primitives, but must preserve the corresponding specimen's visual
choices. Check rendered borders, corners, typography, and spacing in both
runtimes—importing the same component does not prove they use the same theme.
Deliberate feature differences need a concrete reason, such as operational
state or different content, rather than an app-only restyling.

Load shared UI styles before importing feature modules and their composition
styles in each runtime. Equal-specificity rules depend on that order: for
example, the capture specimen's 44px command button must override the shared
large-button minimum height in both workshop and app.

Workshop scratch changes and alternate profiles remain exploratory until
explicitly adopted; the application does not read workshop session files.

## Workspace boundaries

```text
apps/workshop/
  src/                         visual evaluation and workflow UI
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

The workshop discovers `*.specimen.tsx` files from both `components/` and `drafts/`. Their directory determines the Stable or Draft label shown in the library and gallery.

## Artifact terminology

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

- `http://127.0.0.1:5174/` for the focused workbench.
- `http://127.0.0.1:5174/gallery` for paired light/dark library evaluation.

Source and specimen edits refresh through Vite HMR. The local persistence server binds to `127.0.0.1` and exposes only the fixed session and profile routes.

Choose focused tests and builds for the affected boundary using [CODING_STANDARDS.md](../CODING_STANDARDS.md#focused-verification), then check the diff. For example, a UI component change may use:

```sh
pnpm --filter @vela/ui build
git diff --check
```

Run the relevant existing test files for shared artifact validation, local persistence, token resolution, or stable-versus-draft exports when those behaviors are affected. Full `pnpm test` and `pnpm build` are appropriate when the change crosses enough workspace boundaries to warrant them, not as a default for every specimen edit.

Dialog behavior also has a focused Chromium suite because modal focus, dismissal, and restoration depend on browser behavior. Install its browser once, then run it with:

```sh
pnpm --filter @vela/workshop exec playwright install chromium
pnpm --filter @vela/workshop test:browser
```

The suite starts the workshop itself and checks passive gallery previews, modal focus containment and restoration, dismissal, simulated responsive and comparison canvases, and asynchronous specimen state updates.

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

Ordinary workbench changes save automatically to `apps/workshop/.local/session.json`. This is recovery state and remains ignored by Git.

Theme adjustments remain in `unsavedOverrides` until Save or Save As is chosen:

- **Save** deliberately updates the selected tracked profile.
- **Save As** creates or replaces a named profile under `apps/workshop/designs/`.
- Read-only `Vela UI Default` and `Vela Current` profiles cannot be overwritten.
- A fingerprint mismatch is shown as baseline drift. The workshop never rebases a profile automatically.

The local server validates schema version, IDs, primitive props, modes, contexts, viewport bounds, reference ramps, semantic mappings, and theme override keys. Writes are size-limited and atomic. It is not a general filesystem API.

## Use stable URLs and Copy Context

The workbench URL records component, specimen, profile, mode, context, viewport, and controlled specimen props. Paste that URL to reopen the same visual scenario.

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
3. Use the application's adopted Vela Current profile and existing `@vela/ui/styles.css` entry point. Keep shared style loading ahead of feature composition styles; resolve missing tokens at their owning boundary rather than adding a parallel theme adapter.
4. Compare the implemented feature with the running specimen. Preserve its hierarchy, typography, borders, artwork, and interaction feel while keeping wording honest for real operational states. Verify the changed behavior in the actual application context.
5. Prepare the running product and concrete acceptance scenarios through the [delivery workflow](../AGENTS.md#verification-browser-review-and-merge).

Material design departures or global-theme changes outside the agreed scope return to alignment.
