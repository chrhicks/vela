# `@vela/model`

`@vela/model` owns the dependency-free contracts shared by Vela's server and
web applications. It gives both sides one normalized vocabulary without
assigning protocol, transport, persistence, or application behavior to this
package.

## Boundaries

- `@vela/model/device` describes normalized device kinds and live device
  projections.
- `@vela/model/rig` describes Rig identities, endpoints, reachability, and
  discovery projections.
- `@vela/model/web` composes those contracts into page-level views.

Server application code resolves domain state into those views so the browser
can render the result without reconstructing precedence, reconciliation, or
capability decisions. Views remain semantic, typed contracts rather than
generic property bags or preformatted display strings; visual composition,
copy, and formatting remain browser concerns.

The package has no runtime dependencies. In particular, it does not own:

- Alpaca wire fields, response envelopes, schemas, or device numbers;
- HTTP, UDP, or other network behavior;
- YAML schemas, file I/O, or persistence;
- device-specific control behavior;
- React components or client state.

Protocol adapters normalize their values before they cross into these
contracts. Recognizing a `DeviceKind` does not mean Vela implements operations
for that kind. Until a device-specific adapter deliberately supplies status,
the device remains in the normalized `unknown` status state.

## Verification

Run the focused checks with:

```sh
pnpm --filter @vela/model test
pnpm --filter @vela/model build
```

The contract tests compile representative server/web usage and verify that the
package manifest stays free of runtime dependencies.
