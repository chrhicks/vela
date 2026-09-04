# Component Workshop Decision Record

**Status:** Accepted  
**Date:** 2026-08-19  
**Scope:** Product definition and MVP architecture; no implementation is authorized by this document.

This record preserves the MVP decisions and their original rationale. For current agent ownership, task authorization, proportionate verification, and review gates, follow [AGENTS.md](../AGENTS.md#working-with-chris) and the [operations guide](component-workshop-operations.md). An agreed implementation scope can include promotion and adoption without repeated approval requests; exploratory workshop work alone does not.

## Summary

Vela will gain a separate, source-backed component workshop for visually designing a new UI library. The workshop is a solo developer tool, not an end-user theme editor. It will render real React components from a new `@vela/ui` workspace package, provide live visual controls and representative contexts, and support an iterative workflow in which component source is edited through an editor or Codex and refreshed through Vite HMR.

The workshop will not replace Vela's current theme or UI automatically. Draft components and design profiles remain opt-in artifacts. Components are promoted into the stable UI package explicitly and can later be adopted by Vela one at a time.

## Goals

- Make component design approachable through immediate visual feedback.
- Create real, reusable React components rather than disconnected mockups.
- Evaluate component composition, color, typography, spacing, sizing, density, and responsive behavior.
- Preserve enough context to stop and resume work naturally.
- Make collaboration with Codex efficient through stable URLs and a structured **Copy Context** action.
- Keep draft work isolated from stable components and Vela's current UI.
- Produce a cohesive, token-based component library without adopting a large styled component system.
- Deliver functionality in meaningful, reviewable increments.

## Non-goals

- A general-purpose design application or page builder.
- A no-code or drag-and-drop React generator.
- An embedded source editor or general-purpose TSX rewriter.
- An embedded AI chat client.
- An end-user Vela theme-settings surface.
- npm, registry, or external repository publishing.
- Automatic component promotion or automatic replacement of Vela's defaults.
- Exhaustive component-state generation or comprehensive accessibility compliance auditing.

## Workspace architecture

The workshop and UI library will remain in this pnpm workspace but have separate ownership boundaries:

```text
apps/
  workshop/                 # Visual design and evaluation application
packages/
  ui/                       # @vela/ui token contract and component source
    src/
      components/           # Stable components and public exports
      drafts/               # Draft components, not in stable exports
      themes/               # Token contract and stable default themes
```

Expected local workshop state:

```text
apps/workshop/
  .local/session.json       # Ignored automatic recovery state
  designs/*.json            # Tracked named design profiles
```

Exact internal filenames may be refined during implementation, but these ownership boundaries are fixed.

## Artifact vocabulary and ownership

### Working session

The ignored, disk-backed state required to resume naturally. It records the active component, specimen, viewport, light/dark mode, density, prop controls, and unsaved theme adjustments. It is recovery state, not a versioned design artifact.

### Draft component

Real React/TSX source under `packages/ui/src/drafts`. It can be rendered and iterated in the workshop but is not exported by the stable `@vela/ui` API.

### Design profile

A named, tracked JSON artifact containing design-token overrides, a baseline identifier, and a baseline fingerprint. Design profiles are saved explicitly; ordinary slider movement only updates the working session.

### Stable component

A deliberately promoted component under the stable component boundary and exported by `@vela/ui`. Promotion is initially a documented source-code operation, not a workshop button.

### Specimen

A source-backed, curated scenario colocated with a component, for example `Button.specimen.tsx`. Each component begins with a primitive-focused specimen that explains the reusable contract. A materially useful real workflow may appear as a visibly named product-example specimen showing what the primitive can enable. Product examples remain non-exported design references: application features own their copy, state, domain composition, and illustrations, while example-only styling stays in colocated `*.specimen.css`. Specimens do not attempt to generate every possible prop combination.

## Decision log

| ID | Decision | Rationale and consequence |
| --- | --- | --- |
| D-001 | Build a component workshop, not primarily a theme editor. | The current component library is effectively a blank slate. Real component creation is the main need; theme editing supports that work. |
| D-002 | Design for one developer. | Collaboration accounts, permissions, remote storage, and generalized user settings are unnecessary. |
| D-003 | Keep the workshop as a separate app in the same monorepo. | This decouples it from Vela's operational UI while allowing direct workspace consumption and HMR. |
| D-004 | Use source-backed React/TSX components. | Components remain ordinary reviewable source. The workshop supplies visual feedback rather than inventing a proprietary component schema. |
| D-005 | Align with React, Tailwind CSS 4, and semantic CSS variables. | Product coupling stays low while output remains directly usable by Vela. Framework-neutral output would require unnecessary translation. |
| D-006 | Begin with a small primitive library. | Button, IconButton, Input, Select, Checkbox, Badge, Tabs, and Panel/Card expose the foundational design decisions without requiring an application-scale library. |
| D-007 | Use curated specimens plus interactive controls. | Authored scenarios remain meaningful and can be added when a concrete visual problem appears; exhaustive combinations would produce noise. |
| D-008 | Provide generic composition contexts. | Isolated, form/settings, toolbar/action-row, and card/data-list contexts reveal hierarchy and density issues without coupling the workshop to Vela screens. |
| D-009 | Separate reference, semantic, and component tokens. | Generated reference ramps provide breadth; semantic names express intent across modes; component tokens are allowed only for deliberate component-specific needs. |
| D-010 | Support paired light and dark mappings. | A shared semantic vocabulary across both modes tests whether components actually consume the design system. Dark remains especially important for field use. |
| D-011 | Generate editable ramps in OKLCH. | OKLCH produces more perceptually consistent lightness and chroma changes than RGB interpolation while still permitting hex-oriented controls. |
| D-012 | Treat density as a continuous workshop dimension. | Values can be discovered visually before any compact or comfortable presets are formalized. |
| D-013 | Keep diagnostics focused and non-blocking. | Contrast and token-bypass warnings protect cohesion and dark-field usability without turning the tool into a compliance suite. |
| D-014 | Prefer native HTML and in-house visual implementation. | A large styled component library would obscure the design language. Selective headless dependencies remain permissible for interactions that prove difficult to implement correctly. |
| D-015 | Keep draft and stable components in `@vela/ui`. | The workshop renders components but does not own their only source copy. Promotion therefore changes stability and exports rather than transferring files between applications. |
| D-016 | Keep public component props semantic. | Props such as tone, emphasis, and size express intent; raw colors and padding belong to the token system. `className` remains an escape hatch. |
| D-017 | Let `@vela/ui` own the token contract and stable defaults. | Components and themes must share a durable vocabulary independently of the workshop's implementation. |
| D-018 | Persist working state and named profiles to local disk. | Disk recovery survives browser-state loss. Ignored session data avoids Git noise; tracked profiles remain inspectable and versioned. |
| D-019 | Require explicit saves for named profiles. | Continuous scratch recovery should not silently rewrite a deliberately saved design. |
| D-020 | Use session undo/redo and Git history. | A custom revision graph would duplicate source control for a single-user local tool. |
| D-021 | Compare the baseline with one active profile. | Side-by-side comparison materially improves design judgment without requiring multi-profile mixing in the MVP. |
| D-022 | Save profile overrides plus baseline identity and fingerprint. | Concise overrides preserve intent; the fingerprint detects drift in the underlying baseline. |
| D-023 | Keep AI interaction in Codex/chat. | Source changes, screenshots, and browser inspection already provide the collaboration loop; an embedded AI client adds infrastructure without new capability. |
| D-024 | Add stable URLs and Copy Context. | A compact handoff containing component, specimen, profile, mode, density, viewport, and props reduces coordination cost with Codex. |
| D-025 | Authorize draft iteration for the duration of a workstream. | Flow-state iteration should not require repeated permission. Crossing into stable components, defaults, exports, or promotion remains explicit. |
| D-026 | Promote manually and document the procedure. | The correct lifecycle should be proven before automating repository writes and validation behind a Publish button. |
| D-027 | Consume `@vela/ui` directly as workspace source in the MVP. | No distribution build, registry, or package-version workflow is currently needed. |
| D-028 | Preserve Vela's current design as a read-only reference. | `Vela Current` supplies a concrete baseline without making it the design the new library must retain forever. |
| D-029 | Never promote or change defaults automatically. | Saving, promoting, exporting, and changing a default are distinct explicit actions. |
| D-030 | Adopt stable components in Vela one at a time. | Incremental adoption is tangible, reversible, and does not force a coordinated UI or theme replacement. |
| D-031 | Let promoted components inherit compatible Vela variables. | Trying one component must not require a theme migration. Package defaults fill missing values, and named profiles remain optional overlays. |
| D-032 | Deliver meaningful vertical capabilities. | Review points should produce useful workflows, not isolated property-by-property changes. |
| D-033 | Contrast primitive anatomy with optional product examples. | A primitive-focused specimen makes the reusable component understandable; a non-exported, specimen-local real workflow can demonstrate its capability without becoming code that `apps/web` imports or copies wholesale. Product examples justify new primitives only after repeated use reveals a durable contract. |

## Design-token model

The design system has three layers:

```text
Reference palette and scales
  neutral-50 ... neutral-950
  accent-50 ... accent-950
  space-1 ... space-n
          ↓
Semantic tokens with light/dark values
  surface, surface-raised, text, text-muted,
  accent, positive, warning, danger, focus
          ↓
Optional intentional component tokens
  button-height, input-border, panel-padding
```

Components consume semantic or intentional component tokens. Arbitrary one-off values are allowed during exploration but should be visibly flagged. Tailwind handles layout and structural styling; theme-sensitive values resolve through semantic CSS variables. Component variants use explicit TypeScript class mappings rather than dynamically generated Tailwind class names. Runtime CSS-in-JS is out of scope.

The MVP directly edits:

- Generated and individually adjustable color ramps
- Semantic light and dark mappings
- Typography family, size, weight, line height, and letter spacing
- Spacing and sizing
- Border width and radius
- Continuous density

The initial font catalogue uses a small set of system-safe sans, serif, and monospace stacks.

## Workshop experience

The workshop has two levels:

1. A searchable gallery for evaluating library-wide cohesion.
2. A focused workbench for one component.

The focused workbench provides:

- A primitive-focused specimen plus optional, visibly named product-example specimens
- Curated interactive prop controls for reproducible states
- Light/dark and density controls
- A freely resizable canvas
- Wide desktop, compact laptop/tablet, and phone presets
- Isolated, form/settings, toolbar/action-row, and card/data-list contexts
- Baseline-versus-active-profile comparison
- Session undo/redo for profile adjustments
- Explicit design-profile Save and Save As actions
- A stable URL identifying the active component and specimen
- Copy Context output containing the complete visual working context

The workshop automatically discovers component specimens and design-profile files from their prescribed locations and validates profile data against the shared schema. Primitive and product-example specimens share the same controls, stable URLs, and responsive canvas, but have different ownership: only the primitive is a candidate for application import and promotion.

## Local persistence boundary

The workshop development server may expose a tiny local-only persistence boundary. It is restricted to reading and writing the predetermined session and design-profile locations, validates all data, and does not provide arbitrary filesystem access.

The persistence rules are:

- Working-session changes save automatically to an ignored file.
- Named design profiles change only through explicit Save or Save As.
- Component and specimen source changes occur through ordinary source edits.
- No embedded editor or browser-driven general TSX rewriting is included.
- JSON import/export outside the repository is not included in the MVP.

## Iteration and authority model

The primary loop is:

```text
Create a draft component and primitive-focused specimen
              ↓
Add a product example only when real context improves evaluation
              ↓
Render both in the workshop
              ↓
Adjust profile, props, context, density, and viewport
              ↓
Describe a concrete problem in chat
              ↓
Codex inspects the exact workshop context and edits draft source
              ↓
Vite HMR displays the change
              ↓
Repeat until the component is ready for explicit promotion
```

Once a workstream begins for a named draft component or design profile, related edits to its draft source, specimens, and draft profile remain authorized throughout that flow. Explicit direction is required before modifying stable components, stable defaults, public exports, or promotion status.

## Manual promotion contract

A draft may be promoted when:

- Its public props are intentional and semantic.
- Representative specimens exist.
- It works under both the default light and dark mappings.
- It respects the shared token contract.
- The workspace type-check and build pass.
- The owner explicitly chooses to promote it.

Initial promotion is a documented source operation:

1. Move or reclassify the draft under the stable component boundary.
2. Add it to the stable `@vela/ui` export surface.
3. Remove its draft designation and update discovery metadata as needed.
4. Run the relevant proof.
5. Review the resulting source diff.

Promotion does not automatically add the component to Vela or change any default theme.

## MVP delivery

### Step 1: working vertical slice

Deliver a complete design loop using Button, Input, and Panel/Card:

- Workshop shell and focused workbench
- Source-backed specimens
- Token contract and default light/dark themes
- Generated, editable OKLCH ramps
- Typography, geometry, and density controls
- Disk-backed working-session recovery
- Named design-profile saving
- Responsive canvas and generic contexts
- Baseline comparison
- Copy Context and stable specimen URLs

This step is reviewed as one tangible capability before multiplying the component set.

### Step 2: useful component workshop

- Searchable gallery
- IconButton, Select, Checkbox, Badge, and Tabs
- Full initial composition-context set
- Contrast diagnostics
- Raw-value/token-bypass warnings
- Workflow refinements based on actual use

### Step 3: stable MVP

- Complete draft-to-stable lifecycle
- Documented manual promotion process
- Schema tests for design profiles and working-session state
- Focused token-resolution tests across light and dark modes
- Successful workspace type-check and build
- Browser smoke proof of the primary workflow
- Final architecture and usage documentation

## Deferred backlog

Deferred work is not scheduled by this decision record. It should be introduced only when a concrete need proves the additional complexity.

| Backlog item | Why deferred | Trigger to reconsider |
| --- | --- | --- |
| Temporary trial of draft components inside Vela | Requires an additional cross-app draft boundary and is unnecessary to prove the workshop. | Workshop evaluation repeatedly fails to reveal problems only visible in the operational app. |
| Automated promotion or Publish button | Requires safe repository mutation, validation, and failure recovery. | Manual promotion becomes frequent, tedious, and stable enough to automate. |
| Package distribution build | Workspace-source consumption is sufficient. | `@vela/ui` must be consumed outside the current Vite workspace or needs isolated package-boundary verification. |
| npm or registry publishing | There are no external consumers. | A real external consumer or repository appears. |
| Embedded AI interface | Codex/chat plus Copy Context provides the useful loop. | Context transfer remains materially cumbersome despite stable URLs and Copy Context. |
| Embedded code editor | Existing editor and Codex workflows already own source changes. | A concrete workflow cannot be completed efficiently through ordinary source editing. |
| Automatic TSX rewriting from workshop controls | General source generation adds substantial ownership and recovery complexity. | Repeated, well-structured edits prove a safe constrained transformation model. |
| Drag-and-drop composition | Authored specimens provide reproducible context with far less machinery. | Authored contexts consistently prevent useful composition exploration. |
| Multi-profile mixing | Baseline comparison is enough to validate the artifact model. | Multiple valuable profiles exist and selective reuse becomes a repeated task. |
| JSON import/export | Repository-backed files cover the local workflow. | Profiles need to move between repositories or users. |
| External font loading, upload, or bundling | System stacks are enough to establish typography controls. | Typography exploration is demonstrably constrained by the initial font catalogue. |
| Shadows, advanced motion, and decorative effects | Core color, typography, geometry, and density decisions have higher leverage. | Stable components require these properties to express the chosen visual language. |
| Named density presets | Continuous control should establish useful values first. | Repeated density settings emerge and deserve stable names. |
| Specialized astronomy night mode | Paired light/dark mappings establish the semantic model first. | Field evaluation proves that ordinary dark mode is insufficient. |
| Advanced consistency diagnostics | They need a larger component corpus to produce useful evidence. | Enough stable components exist to compare spacing, sizing, focus, and status conventions. |
| Comprehensive accessibility or ARIA audit | The tool is single-user and the primary requirements are cohesion, contrast, and field usability. | The component library gains production consumers with broader accessibility requirements. |
| Large styled component library | It would work against designing an in-house visual language. | A specific proven requirement cannot be met reasonably with native HTML or a focused headless primitive. |
| Automated coordinated Vela migration | Component-by-component adoption is safer and reversible. | Incremental adoption becomes a demonstrated impediment rather than a safety advantage. |

## Documentation required by MVP completion

- Workshop architecture and ownership boundaries
- Artifact terminology
- Adding a draft component
- Authoring and discovering primitive-focused and product-example specimens
- Keeping product-example styling and assets non-exported
- Creating, saving, and comparing design profiles
- Working-session recovery behavior
- Using stable URLs and Copy Context with Codex
- Running validation and browser smoke proof
- Manually promoting a draft component to stable
- Adopting a stable component in Vela without changing the default theme

## Intentionally open design space

The exact aesthetic, final token values, detailed component APIs, and final specimen contents are not unresolved architecture decisions. Discovering them through use is the purpose of the workshop. New complexity should enter only in response to explicit, observed needs.
