# Component Workshop Operations Guide

This guide is the repeatable operating procedure for designing, validating, promoting, and eventually adopting components from `@vela/ui`. The accepted product and architecture decisions remain in [Component Workshop Decision Record](component-workshop.md).

The workshop is a local developer tool. None of the procedures below publish a package, change Vela's default theme, apply a named design profile to Vela, or adopt a component into the Vela application automatically.

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

Run the repeatable non-browser proof with:

```sh
pnpm test
pnpm build
git diff --check
```

The focused tests cover shared artifact validation, local persistence validation, paired light/dark token resolution, complete reference ramps, and stable-versus-draft exports.

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

Run this checklist for a meaningful library change and every promotion. Record the result in the corresponding Linear issue. Keep browser automation focused on behavior that genuinely depends on a browser rather than turning every visual state into a brittle test.

1. Start from a fresh browser load of `/gallery` and confirm there are no console errors.
2. Confirm every expected component is discoverable and labeled Stable or Draft correctly.
3. Inspect paired light and dark previews under the current default profile.
4. Search for the changed component and open its primitive-focused specimen; inspect each product example separately.
5. Exercise every semantic prop control and at least one direct interaction inside the preview.
6. Confirm direct interactions update the inspector, stable URL, session state, and Copy Context when applicable.
7. Check isolated and at least one representative composition context. For product examples, also confirm the real workflow remains visually intact and its styles remain specimen-local.
8. Check wide, compact, and phone preview widths; include the important dark-field mode.
9. Change density and enable baseline comparison.
10. Review focused contrast and literal-color diagnostics.
11. Reload the stable URL and confirm recovery is coherent.
12. Run `pnpm test`, `pnpm build`, `pnpm --filter @vela/workshop test:browser` when relevant, and `git diff --check`.

This checklist is targeted evidence, not an exhaustive state generator or accessibility audit.

## Manually promote a component

Promotion requires explicit owner approval for a named component. It is deliberately performed through an inspectable source diff.

Before promotion, confirm:

- Public props are intentional and semantic.
- Representative specimens exist.
- Paired light and dark rendering is coherent.
- The component uses the shared token contract.
- Focused tests and the workspace build pass.

Then:

1. Move `ComponentName.tsx` and its specimens from `drafts/` to `components/`.
2. Update specimen imports and any draft consumers to use the stable component boundary.
3. Remove the component export from `packages/ui/src/drafts/index.ts`.
4. Add the component export to `packages/ui/src/components/index.ts`; the stable root re-exports that boundary.
5. Confirm workshop discovery labels the component Stable and retains its stable specimen URL.
6. Add or update an export-boundary test proving the stable root contains the component and the draft surface does not.
7. Run the targeted browser checklist and non-browser proof.
8. Review the final diff for unrelated adoption, profile, or default-theme changes.
9. Commit the promotion as a meaningful, explicit change.

Button at the CHI-86 fixed point is the first individually proven example of this procedure. After that proof was accepted, the owner explicitly approved the remaining seven components as the initial stable component baseline; they followed the same source, export, test, and browser-proof operation. The draft boundary remains available for experimental work without exposing drafts from the stable package root.

## Adopt one stable component in Vela later

Promotion does not adopt a component. Adoption is a separate, explicitly approved Vela change performed one component and one real use site at a time. When a component has a product-example specimen, `apps/web` imports only the promoted primitive. Rebuild the production feature from web-owned state, copy, domain markup, and assets; never import the specimen or treat its TSX as a feature module.

For a future Button adoption:

1. Choose one existing Vela action and define the behavior and visual acceptance case.
2. Import `Button` from `@vela/ui`, never from `@vela/ui/drafts`.
3. Import `@vela/ui/styles.css` once at the appropriate application style boundary.
4. Add a narrow Vela-owned variable adapter around the adopted surface, mapping required `--vela-*` semantic variables to compatible existing `--ui-*` variables. Do not replace Vela's theme or apply a workshop profile.
5. Verify behavior and appearance in the actual application context.
6. Keep the change reversible and do not migrate adjacent components without separate intent.

Any missing variable must be handled deliberately at that adoption boundary. Adoption must not silently change global defaults.

## What remains manual

- Source edits and specimen authoring
- Profile Save and Save As
- Owner approval for promotion
- File movement and export changes
- Browser checklist execution
- Vela adoption
- Default-theme changes

There is no Publish button, package registry workflow, automatic promotion, automatic profile application, or automatic application migration.
