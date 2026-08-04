# Third-Party Licenses

MPX's own code and content is released under CC0 1.0 Universal (see `LICENSE.md`) — but that can only apply to work this project actually holds the rights to. The third-party work below is used under its own license/permission, never CC0.

Theme assets are tracked **per theme**, not as one blanket statement — a different theme can (and likely will) bundle different fonts under different terms. This file gets a new theme section whenever a theme is added.

## Localization catalog (`core/src/catalogEn.ts`, `catalogFr.ts`)

Sourced from `encounterplus/dnd5e`'s own `lang/en.json`/`lang/fr.json` (<https://github.com/encounterplus/dnd5e/tree/main/lang>), re-synced periodically by `.github/workflows/sync-catalogs.yml` (opens a PR, never auto-merges).

That repository has no `LICENSE` file or other public license declaration of its own. Permission to use and redistribute it was requested and granted directly by the EncounterPlus developer via Discord, confirmed 2026-08-03 — the developer confirmed free use of anything published under the `encounterplus` GitHub projects and suggested MIT terms specifically. Treated here as an MIT grant for `lang/en.json`/`lang/fr.json` on that basis.

## Theme: `5.5e` (`extension/resources/themes/5.5e/font/`)

All from **Solbera's D&D 5th Edition Fonts** collection — free remakes of the fonts used in official D&D 5th Edition books (the originals are commercial/proprietary and not legally redistributable; these are original recreations, not extracted copies). Created by Solbera, with fixes from Ryrok and Ners, and further adjustments from LUCASTUCIOUS. Canonical collection: <https://github.com/jonathonf/solbera-dnd-fonts>.

**License: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)** — <https://creativecommons.org/licenses/by-sa/4.0/>. Requires attribution (this file) and that any redistribution, modified or not, stays under the same license. The fonts themselves may not be sold standalone.

- `Bookinsanity*.woff2` (Regular, Bold, Italic, Bold-Italic)
- `MrEavesSmallCaps-Reloaded.woff2`
- `Scaly-Sans*.woff2` and `Scaly-Sans-Caps*.woff2` (Regular, Bold, Italic, Bold-Italic)
- `Solbera-Imitation-Tweak.woff2`

One font in this theme is unrelated to the Solbera collection:

- `Walter-Turncoat.woff2` — a standalone Google Fonts release by Sideshow, **Apache License 2.0** (free for personal and commercial use). <https://fonts.google.com/specimen/Walter+Turncoat>

Every other bundled asset in this theme (CSS, images) is original work created for this project or its upstream (see `docs/themes.md`), covered by the project's own CC0 license.
