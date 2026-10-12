# Vela architecture

[AGENTS.md](../AGENTS.md) is the product authority. This page shows where things live.

## Shape

```text
Browser ──> Vela server ──> @vela/equipment ──┬─> Alpaca adapter ──> Alpaca server (e.g. Seestar)
                                              └─> Cria adapter ───> Cria on the rig PC (e.g. FRA 400)
```

- **Browser** renders what the Vela server projects, including which actions are available. It holds no rig credentials and talks to no device.
- **Vela server** owns runs, workflows and decisions, in memory: capture repetition, autofocus, framing, plate solving, alignment, previews, FITS and saved images.
- **`@vela/equipment`** is the narrow set of capabilities workflows use: acquisition, framing, focuser, cooling, mount control, inventory, inspection and connection.
- **Cria** polls devices, streams state, runs bounded operations identified by request IDs, and holds originals briefly until Vela fetches them. It is a .NET 10 API with isolated .NET Framework 4.8 driver workers over StreamJsonRpc. See `chrhicks/cria` `docs/architecture.md` and `contract/openapi.json`.

## Rig modes

Each rig uses exactly one mode, chosen at composition in `apps/server/src/equipment/composition.ts`. A rig record without `source` uses Alpaca; `source: { kind: cria, … }` uses only that Cria configuration. A missing or failing Cria service never falls back to Alpaca.

- **Alpaca** talks directly to an Alpaca server. Use it for devices such as the Seestar.
- **Cria** talks HTTP and SSE to Cria on a rig's local PC. Use it for the FRA 400 and any rig whose devices are managed by a local PC.

## Where things live

| Responsibility | Code |
| --- | --- |
| Projections the browser renders, user actions | `apps/web`, `packages/model` |
| Routes, workflow controllers, in-memory runs | `apps/server/src/{capture,autofocus,alignment,targets,rig}` |
| Rig operation lane (prevents conflicting physical work) | `apps/server/src/rig/operations.ts` |
| Mode selection and capability factories | `apps/server/src/equipment` |
| Capability contracts and ImageBytes decoding | `packages/equipment` |
| Alpaca protocol, discovery and normalization | `packages/alpaca` |
| Cria HTTP/SSE client and wire validation | `packages/cria` |
| Mapping Cria observations and operations to capabilities | `apps/server/src/cria` |
| Preview, FITS and image analysis | `apps/server/src/imaging` |
| Saved images | `apps/server/src/saved-images` |

Some routes still build Alpaca capabilities directly. New workflow code takes capabilities from the composition.

Scheduled for removal, do not extend: the acquisition archive and Cria custody/receipt code in `apps/server/src/acquisitions`, `apps/server/src/cria/custody.ts` and `apps/server/src/cria/archive-health.ts`.

## Runs are ephemeral

- A capture run and every workflow live in Vela server memory. A browser can disconnect and reconnect without ending them.
- If the Vela server or Cria crashes or restarts, the run is interrupted and reported honestly. Vela does not persist sessions, continue after a restart, or reconcile with Cria afterward.
- A new Vela server or Cria instance means anything in flight before it is unknown. Start fresh.
- Within a running process, never blindly replay a command whose outcome is unknown. Inspect the device if the adapter can say reliably; otherwise stop and tell Chris.
- Heavy image processing stays on the Vela server, not the rig PC.
