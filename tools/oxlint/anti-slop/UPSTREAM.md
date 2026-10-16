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

Local changes replace the Effect service-constructor import rule with
`no-ending-escape` and `no-service-graph`, backed by the shared
`effect/shared/effect-import.ts` resolver. Other bundled source files retain
upstream formatting. Local additions also include this provenance record and
the upstream root MIT `LICENSE`.
The nested `vendor/eslint-stylistic/LICENSE` and `UPSTREAM.md` are preserved.
The parent `tools/oxlint/package.json` declares ESM without changing the root
package's module semantics.

Root `.oxlintrc.json` enables all 18 generic rules, four upstream Effect rules,
two local Effect rules, and native
`oxc/no-accumulating-spread` at error severity. Agent tooling, generated output,
local data, and the vendored implementation are excluded from application lint.
`oxlint` and `@oxlint/plugins` are pinned together at `1.82.0`. The root
`pnpm lint` command runs Oxlint. The local rules resolve Effect imports through
lexical bindings, including aliases, namespace imports, subpaths, and literal
member access.
`no-ending-escape` applies to server workflows and rig jobs. `no-service-graph`
applies throughout Vela source, including its packages. Wire imports stay in
`packages/cria`; Effect and Cria imports are forbidden in the shared model and
browser.

`tools/oxlint/effect-rules.test.ts` runs the real CLI against the root
configuration in disposable fixtures. It is included in `pnpm test`.

Initial validation: plugins load and `pnpm build` passes across the workspace,
including its TypeScript checks. `pnpm lint` fails on existing application
findings; installation does not authorize application cleanup. The full local
diagnostics are available at `data/anti-slop/lint.json` (ignored by Git) and can
be regenerated with `pnpm exec oxlint --format json`. No rules were weakened and
no application source was changed.
