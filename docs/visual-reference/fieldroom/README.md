# Fieldroom reference snapshots

These are immutable 1x PNG exports of the approved Paper application and design
system, frozen before implementation. They are design references, not browser
regression baselines or evidence that production behavior already exists.

- [Application page](https://app.paper.design/file/01M3SATFK7ZW5ZCBPFSWD6XS91/p-1-0)
- [Design system](https://app.paper.design/file/01M3SATFK7ZW5ZCBPFSWD6XS91/p-3-0)
- [Manifest](manifest.json): exact node IDs, names, export time, dimensions,
  SHA-256 hashes, and application-only phone crop rectangles.
- [Coverage map](coverage.md): production owners and planned deterministic scenes.
- [Adoption plan](../../fieldroom-adoption.md): implementation order and gates.
- [Previous appearance](../vela-current/README.md): separately frozen browser output.

The initial snapshot contains 24 application boards and 16 system boards.
Some app boards are state sheets rather than single routes. Desktop references
have their actual content height, including 921px, 965px, and 989px screens.
Phone boards are 390 × 844 with a 62px mock OS strip; compare production content
at 390 × 782 after cropping that strip. Never render a fake OS strip in Vela.

Use the app boards for composition and the measured system specimens for shared
recipes. DS.14 supplies the paired semantic colors; DS.15 covers dark states;
DS.16 specifies appearance preference and resolution. Light and dark retain
identical geometry and photographic pixels. Design sample values and imagery
must remain fixture data, never fabricated operational state.

The exposure illustration is the existing local Crescent image at
`packages/ui/src/drafts/target-framing/crescent.jpg`. Related Andromeda and M13
assets live beside it. Operational imagery comes from actual capture endpoints.
The old simulator star field is retained in the previous-appearance archive.
Asset hashes are in [assets.json](assets.json); font installation and licensing
are recorded at their owning `packages/ui/src/fonts/README.md` boundary during
the foundations slice.

Keep the snapshots unchanged. Store comparison screenshots separately and
record explicit deviations or a new version if the design is intentionally
revised. Do not overwrite a reference to make a failing comparison pass.
