# Application composition

Shell composes navigation and existing routes under the application appearance
initialized in `main.tsx`. Root tokens inherit from that composition;
[appearance](../../appearance/README.md) owns configuration and browser mode.

A rig route mounts one `RigObservationProvider`, keyed by rig identity. It owns
the existing `useRigDetail` read and paced refresh. Navigation, rig detail, and
Tonight consume its explicit `useRigObservation` contract. Home has no rig
provider and never requests an empty rig ID. Switching routes within the same
rig preserves the observation; switching rigs resets it. Connection preparation
continues to own its own command outcomes.

Alignment and autofocus contribute a compact navigation context on phones:
Tonight return link, current rig name, and the existing Appearance control.
The same control remains mounted across breakpoints; the full navigation stays
available on desktop. Other active capture state remains reachable in a separate
compact row rather than disappearing during preparation.
