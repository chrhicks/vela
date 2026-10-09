# Vela gaps and acceptance

[Architecture index](README.md) · **No application or physical tests run for this documentation milestone.**

## Shared gaps, Vela work

Use the [shared improvement catalogue](https://github.com/chrhicks/cria/blob/docs/architecture-baseline-20261008/docs/architecture/improvements.md) as the canonical delivery/status record; the [gap register](https://github.com/chrhicks/cria/blob/docs/architecture-baseline-20261008/docs/architecture/decisions-and-qualification.md#gap-register) defines the gaps. Vela has no duplicate backlog. The [Opus brief](https://github.com/chrhicks/cria/blob/docs/architecture-baseline-20261008/docs/architecture/opus-preservation-brief.md) scopes the first preservation/result-recovery work.

| Shared gap | Vela acceptance responsibility |
| --- | --- |
| G1 preservation | Every acquisition consumer reaches durable archive verification; no release-after-decode; source/manifest/receipt identities survive restart |
| G2 result discovery | Read a verified recovered result while preserving equipment uncertainty; no requirement to clear an interlock merely to save an image |
| G3 session continuity | Restore intent, exact requests, accepted stop, limits and budgets; revalidate before continuing; count sources once |
| G4 lifecycle | Clearly distinguish service start/release, session preparation/ending and deliberate external handoff |
| G5 protection | Show Cria's qualified protection outcome/blocker; do not invent environmental policy or duplicate driver control |
| G6 readiness | Forecast destination storage and show why acquisition is paused; continue recoverable transfers appropriately |
| G7 observability | Correlate session → request → operation → source image → archive receipt |
| G8 compatibility | Test actual Vela/Cria versions and durable records across agreed upgrade/rollback cases |

## Concrete acceptance scenarios

1. **Lost response, then Vela restart:** one admitted exposure, recovered by original identity. Reconciliation does not create another request or restart healthy hardware.
2. **Saved artifact, receipt not sent:** Vela rediscovers and verifies it, completes the same acknowledgement, and counts one acquisition.
3. **Receipt accepted, response lost:** Cria's known receipt/release state settles the retry. An extra retained copy is acceptable; missing the only copy is not.
4. **Preview/analysis fails or image is obstructed:** original/context still reach preservation. Show the separate scientific/processing failure.
5. **Autofocus/framing/alignment capture:** the same preservation invariants hold outside the Capture screen.
6. **Stop acknowledged before crash:** restart sends no next exposure. An already completed result is still archived; a pending physical stop remains unconfirmed until evidence arrives.
7. **Session limit passed during downtime:** no fresh duration or reset retry budget. D2 determines remaining allowed work; archive reconciliation may continue.
8. **New API binding or replacement/regressed store:** no silent retarget or replay. Reconcile existing identities; surface a blocker if evidence cannot establish history.
9. **Recovered image with blocked owner:** preserve verified data without describing the equipment as ready. A fresh frame cannot be inferred from geometry alone.
10. **Archive full/unavailable:** recover/transfer the same source when capacity returns. Pause new work within actual capacity; no automatic expiry of unacknowledged originals.

Use production adapters/controllers/storage in focused offline checks. Separate-process fixtures are appropriate for HTTP loss and process boundaries; physical trials must separately establish installed-driver behavior. Independent verification and Chris's browser acceptance remain delivery requirements when implementation changes are later proposed; this baseline does not perform or bypass them.

## Historical adoption status

Earlier independent verification reported success for adoption head `d5de035`, including tests, builds and browser/integration checks. Earlier physical trials reported original/FITS export and saved artifacts. These establish their historical scope; they do not prove the newer preserve-all receipt/session protocol. PR #90 was open/draft with Chris's browser acceptance pending when inspected in the preceding review. No PR state or code was changed here.

## Documentation validation

The documentation-only checks cover relative links/source locations, Mermaid syntax/rendering and Git scope/whitespace. Shared [evidence](https://github.com/chrhicks/cria/blob/docs/architecture-baseline-20261008/docs/architecture/evidence.md#documentation-validation) records the completed results. No build, fixture, browser acceptance of the application or physical test is implied.
