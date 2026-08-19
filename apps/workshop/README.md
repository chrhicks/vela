# Vela Component Workshop

The workshop is a local, source-backed environment for designing real components in `@vela/ui`. It does not replace Vela's current theme or automatically export, promote, or adopt components.

## Run it

```sh
pnpm dev:workshop
```

Open `http://127.0.0.1:5174` for the focused workbench or `http://127.0.0.1:5174/gallery` for library-wide evaluation. Component and specimen source edits refresh through Vite HMR.

## Current workshop

- Stable Button plus draft IconButton, Input, Select, Checkbox, Badge, Tabs, and Panel/Card components
- Auto-discovered colocated specimens
- One primary specimen per component, with additional specimens added only for concrete scenarios that prop controls cannot express
- A searchable gallery with paired light and dark previews
- Fixed isolated, form/settings, toolbar/action-row, and card/data-list compositions built from the real drafts
- Generated and individually adjustable neutral, accent, positive, warning, and danger OKLCH ramps
- Editable paired light and dark semantic mappings
- Typography, geometry, density, prop, context, and viewport controls
- Baseline comparison
- Focused contrast diagnostics and a literal-color source audit
- Stable component/specimen URLs and Copy Context
- Automatic ignored session recovery
- Explicit tracked design-profile Save and Save As

Gallery cards intentionally contain live component previews and a separate Open action. The gallery is for judging cohesion; the workbench remains the place to adjust props, contexts, responsive width, and theme values for one component.

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
packages/ui/src/drafts/       draft React components and specimens
apps/workshop/src/            workshop experience
apps/workshop/designs/        named tracked profiles
apps/workshop/.local/         ignored recovery state
```

Stable components are exported from the `@vela/ui` root. Drafts are available only through the explicit `@vela/ui/drafts` development boundary.

See the [operations guide](../../docs/component-workshop-operations.md) for adding drafts, authoring interactive specimens, persistence, targeted browser proof, manual promotion, and later one-at-a-time Vela adoption.
