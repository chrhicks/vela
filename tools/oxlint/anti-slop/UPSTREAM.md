# Anti-slop provenance

Installed from https://github.com/dmmulroy/anti-slop at commit
`c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` on 2026-09-10.

The supplied `.agents/skills/install-anti-slop/assets/anti-slop` bundle was
compared recursively with `skills/install-anti-slop/assets/anti-slop` at that
commit and matched byte for byte. That Git revision is the recoverable pristine
baseline for future updates.

Installed entry points:

- `tools/oxlint/anti-slop/index.ts`
- `tools/oxlint/anti-slop/effect/index.ts`

All bundled source files are unchanged, including upstream formatting. Local
additions are this provenance record and the upstream root MIT `LICENSE`.
The nested `vendor/eslint-stylistic/LICENSE` and `UPSTREAM.md` are preserved.
The parent `tools/oxlint/package.json` declares ESM without changing the root
package's module semantics.

Root `.oxlintrc.json` enables all 18 generic rules, the five Effect rules
(`packages/alpaca` directly depends on Effect), and native
`oxc/no-accumulating-spread` at error severity. Agent tooling, generated output,
local data, and the vendored implementation are excluded from application lint.
`oxlint` and `@oxlint/plugins` are pinned together at `1.82.0`. The root
`pnpm lint` command runs Oxlint. Effect service-constructor import enforcement
covers relative project imports; package-alias imports remain a limitation.

Initial validation: plugins load and `pnpm build` passes across the workspace,
including its TypeScript checks. `pnpm lint` fails on existing application
findings; installation does not authorize application cleanup. The full local
diagnostics are available at `data/anti-slop/lint.json` (ignored by Git) and can
be regenerated with `pnpm exec oxlint --format json`. No rules were weakened and
no application source was changed.
