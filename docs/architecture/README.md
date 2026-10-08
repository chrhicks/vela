# Vela architecture with Cria

**Living baseline, draft 1 — 8 October 2026.** Chris authorized documentation before implementation improvements. This directory describes Vela's responsibilities and the Cria adoption implementation at `d5de035bd064605fab13ac254a1597201bc39b92`. It does not claim that the adoption branch is merged or that all approved requirements are implemented.

## Reading path

| Question | Document |
| --- | --- |
| What happens in the browser, Vela server and Cria? | [Application design and diagram](design.md) |
| What must survive restart, and when is an image safely archived? | [Session and archive design](session-and-archive.md) |
| What is incomplete and how will it be verified? | [Gaps and acceptance](qualification.md) |
| What work and PRs come next? | [Shared improvement catalogue](https://github.com/chrhicks/cria/blob/docs/architecture-baseline-20261008/docs/architecture/improvements.md) and [exact Opus brief](https://github.com/chrhicks/cria/blob/docs/architecture-baseline-20261008/docs/architecture/opus-preservation-brief.md) |
| Who owns the shared command/image contract? | [Cria technical contracts](https://github.com/chrhicks/cria/blob/docs/architecture-baseline-20261008/docs/architecture/contracts.md) |
| Why use this .NET structure beside the rig? | [Cria assessment](https://github.com/chrhicks/cria/blob/docs/architecture-baseline-20261008/docs/architecture/dotnet-assessment.md) |
| Which policy choices remain open? | [Shared decision register](https://github.com/chrhicks/cria/blob/docs/architecture-baseline-20261008/docs/architecture/decisions-and-qualification.md#open-decisions) |

Vela owns observing intent, preparation, sequencing, focus/pointing/quality, bounded adaptation, recovery from its end, session ending and archives. Cria owns hardware execution/facts, recoverable originals, local storage and qualified device protection. Observer owns goals, contextual environmental safety and intervention. The authoritative approved boundary and decision provenance live in [Cria ownership](https://github.com/chrhicks/cria/blob/docs/architecture-baseline-20261008/docs/architecture/ownership.md).

## Status and maintenance

**Current** refers to inspected source. **Approved requirement** refers to Chris's recorded choices. **Proposed** labels an engineering design. **Open** labels an unchosen policy. Historical trials prove only their reported scope. New prose is not hardware qualification or implementation authorization.

Cria owns the shared protocol/invariants; Vela owns this application-specific design. Update the owning page and link dependents. Do not copy a second authoritative command or receipt specification here. Use shared D/G identifiers for decisions/gaps, record date and revision when behavior changes, and close gaps only with relevant evidence.

Cross-project documentation links point to the companion review branch on GitHub; source evidence links use the exact inspected commit. Cria is a private repository, so its links require repository access. After the docs merge, retarget companion documentation links to the accepted branch or revision before deleting the review branches. For local reading, the URL identifies the repository and document path. No scratch report or machine-specific path is required.

The root `AGENTS.md` and older capture documentation describe ephemeral runs as an earlier product scope. Chris's explicit 2026-10-08 restart requirement now calls for rebuilding context and reconciling before continuation. This supersedes that narrow intent while retaining the preference against a general workflow engine. The implementation remains ephemeral until changed. Existing instructions outside `docs/architecture` were deliberately left untouched in this documentation-only milestone.

## Provenance

Review: [Vela PR91](https://github.com/chrhicks/vela/pull/91) targets `feature/cria-v2-adoption`; [Cria PR1](https://github.com/chrhicks/cria/pull/1) holds the shared baseline and catalogue. This documentation PR depends on the adoption branch and contains no adoption implementation changes.

The primary Vela checkout inspected was clean at `91ed4310f1364d90c995f14ef62e213b50877fd4` on `workshop/capture-preparation`. This documentation branch is based on the actual Cria adoption worktree at `d5de035`, not that earlier checkout. It is isolated on `docs/architecture-baseline-20261008`; the adoption branch is unchanged.

Shared [evidence and primary-source register](https://github.com/chrhicks/cria/blob/docs/architecture-baseline-20261008/docs/architecture/evidence.md) records exact revisions, approved records, runtime reporting, historical trial limits and Microsoft/ASCOM sources accessed 2026-10-08. The initial drafting decision authorizes this living body, not the proposed format, session-ending policy or numerical thresholds. See [validation](qualification.md#documentation-validation) for the checks performed on these pages.
