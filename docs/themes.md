# Themes

Each theme is a self-contained set of CSS/image/font assets in `extension/resources/themes/<id>/`, copied into a project's own `assets/` folder at creation time (or on resync) — see [Create Module Project](Create-Module-Project#theme-selection) for how a theme is picked, switched, or resynced, and the [Project Panel](Project-Panel)'s Theme entry.

This page documents each theme's own identity — visual design and, critically, **licensing**, tracked separately per theme (see [THIRD-PARTY-LICENSES.md](https://github.com/BriocheMasquee/module-packer-extended/blob/main/THIRD-PARTY-LICENSES.md) at the repo root) since a different theme can bundle entirely different third-party fonts under entirely different terms — nothing here is a blanket statement covering every theme at once.

## `5.5e`

The only theme bundled today, and the fixed default for every project until a second one exists. Modern D&D 5.5e (2024 core rulebook) appearance.

**Fonts** — all confirmed third-party, licensed and attributed in [THIRD-PARTY-LICENSES.md](https://github.com/BriocheMasquee/module-packer-extended/blob/main/THIRD-PARTY-LICENSES.md#theme-55e-extensionresourcesthemes55efont):
- Bookinsanity, Mr Eaves Small Caps Reloaded, Scaly Sans (+ Caps) — Solbera's D&D 5e font collection, CC BY-SA 4.0.
- Solbera Imitation Tweak — same collection, used for the drop-cap letter that opens a page's first paragraph.
- Walter Turncoat — a standalone Google Fonts release (Apache 2.0), unrelated to the Solbera collection.

**CSS** — `extension/resources/themes/5.5e/css/global.css`, uses CSS custom properties for its color palette (`--color-blue`, `--color-signature`, ...) and per-element accent variables (`--blockquote-accent`, `--table-accent`) — every color-class variant (`.blue`, `.red`, ...) across blockquotes/tables/statblocks/text derives from this one palette. `custom.css` is the project's own empty starting point for overrides, never touched by a resync once it exists.

## Not included (yet)

- **`legacy`** (the classic Module Packer appearance, ported from old MPX) — tracked in [issue #29](https://github.com/BriocheMasquee/module-packer-extended/issues/29). Not a straightforward port: its markup conventions (`.spell-block`/`.item-block` instead of `.compendium-block-*`, an older `.statblock-*` structure, no CSS custom properties at all) predate the current renderer's class contract entirely — closer to authoring a new theme, using legacy's look as a reference, than copying files over.
