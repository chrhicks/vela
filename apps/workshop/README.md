# Vela Component Workshop

The workshop is a local, source-backed environment for designing real components in `@vela/ui`. It does not replace Vela's current theme or automatically export, promote, or adopt components.

## Run it

```sh
pnpm dev:workshop
```

Open `http://127.0.0.1:5174`. Component and specimen source edits refresh through Vite HMR.

## Current vertical slice

- Draft Button, Input, and Panel/Card components
- Auto-discovered colocated specimens
- Generated and individually adjustable OKLCH ramps
- Editable paired light and dark semantic mappings
- Typography, geometry, density, prop, context, and viewport controls
- Baseline comparison
- Stable component/specimen URLs and Copy Context
- Automatic ignored session recovery
- Explicit tracked design-profile Save and Save As

## Persistence

The Vite development server exposes a local-only persistence boundary:

- `.local/session.json` is ignored recovery state and updates automatically.
- `designs/*.json` contains tracked named design profiles and changes only through Save or Save As.
- Built-in `Vela UI Default` and `Vela Current` profiles are read-only references.

The boundary accepts only the fixed session and profile routes, validates payload shape, restricts profile IDs, limits request size, and writes atomically. It is not a general filesystem API.

## Source ownership

```text
packages/ui/src/themes/       token contract and defaults
packages/ui/src/drafts/       draft React components and specimens
apps/workshop/src/            workshop experience
apps/workshop/designs/        named tracked profiles
apps/workshop/.local/         ignored recovery state
```

Drafts are available through the explicit `@vela/ui/drafts` development boundary. They are not exported from the stable `@vela/ui` root.
