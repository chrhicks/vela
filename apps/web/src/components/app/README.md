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
