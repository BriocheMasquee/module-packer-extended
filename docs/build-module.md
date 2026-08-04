# Build Module

Compiles the current module project into a single `.module` file, ready to import into EncounterPlus V5.

## How to use it

Run `MPX: Build Module` (palette, or the button in the [Project section](Project-Panel)'s title bar). Open files are saved automatically first. If more than one workspace folder is open, you're asked which one to build.

## What happens

- `module.json` is read and validated. If it has no `id`, one is generated and written back so it stays stable across builds. Beyond the required fields, `category` (if set) must be one of the EncounterPlus-defined values, and `tags` (if set) must be an array of strings.
- Every page, group, map, and encounter is read and validated.
- Every slug (module, page, group, map, encounter) must contain only lowercase letters, digits, and hyphens — no spaces, accents, or uppercase. EncounterPlus fails to import a module otherwise, so the build catches it first.
- In the built archive's `module.json`, optional fields left empty (`""` or `[]`) are removed entirely rather than kept as empty values — matching what a real EncounterPlus-generated module.json looks like. The project's own `module.json` on disk is untouched (it keeps every field, for editing).
- **All issues are collected before failing** — if several files have problems, you get the full list at once (in the "MPX" output channel), not one at a time.
- IDs are resolved: for pages/groups, an explicit `id` is kept if it's a valid UUID, otherwise one is derived deterministically from the slug (same slug → same id across builds). For maps/encounters, the id is **always** recomputed from the slug — any `id` present in the reference file or the export archive is ignored.
- Parents are resolved **strictly**: an unknown parent slug, a duplicate slug (across any of the 4 types), a parent cycle, or using a map/encounter as a parent all fail the build with a clear error. This is stricter than the Module Explorer view, which stays lenient (invalid parents just show at the root) so editing doesn't feel broken while you're mid-change.
- Page Markdown is rendered to HTML (tables, sub/sup, mark, underline, and heading anchors are supported, matching the original MPX).
- `images/` and `assets/` are copied into the archive.
- `module.json`'s `image`/`banner` files (declared at the project root) are bundled at the archive root.
- The archive is written uncompressed (stored), which is what EncounterPlus expects — a compressed archive fails to import.

## Version auto-increment

If the `mpx.autoIncrementVersion` setting is on (the default, in `.vscode/settings.json`, editable via the "Project Settings" entry in the [Project section](Project-Panel)), the patch number of `module.json`'s `version` is bumped after a successful build (e.g. `1.0.0` → `1.0.1`) — so the next build starts from a new value.

The `.module` archive just produced always keeps the version it was built with; the bump only prepares `module.json` for the *next* build. If you edit the version by hand (e.g. to `2.0.0`), the very next build still uses `2.0.0` unchanged — only the build after that becomes `2.0.1`.

## Maps and encounters: the real export format

A map or encounter reference file (`maps/<slug>.json` / `encounters/<slug>.json`) doesn't hold the map/encounter data itself — its `path` field must point to a real **EncounterPlus export archive** (a zip), which contains:

- A manifest at the archive root — `maps.json` for maps, `encounters.json` for encounters — holding a JSON array with **exactly one object** (the actual map/encounter data: grid, tokens, etc. for maps; combatants, etc. for encounters).
- Any number of resource files (images, etc.), at any path inside the archive.

At build time, MPX reads that archive, merges its resources **flat at the root of the `.module`** (EncounterPlus never sees the original export zip — MPX unpacks it), and produces the final record by combining the export's data with the local reference file's `name`/`slug`/`rank`/`descr` (the local file wins when both are set).

- For maps only, if the export's `image` or `floor` field is set, the resource it names must actually be present in the archive — image/floor are not required fields themselves, only checked when set.
- If two different exports (map or encounter) contain a resource with the same internal name, or a resource's name collides with a reserved module file/folder (`images/`, `assets/`, `*.json` manifests, etc.), the build fails rather than silently overwriting one with the other.
- `path` is protected against path traversal (it can't resolve outside the project folder) — the same protection applies to `module.json`'s `image`/`banner`.

## Items, spells, roll tables, and monsters

Unlike maps/encounters, these are authored directly as standalone JSON files — `items/<slug>.json`, `spells/<slug>.json`, `tables/<slug>.json`, `monsters/<slug>.json` — created with the [Compendium](Compendium) panel's buttons and validated against their own EncounterPlus schema while editing.

- Each file needs its own explicit, permanent UUID `id` — unlike maps/encounters, it's never recomputed from the slug.
- Every enum-like field (item `type`/`rarity`/`properties`/`mastery`/`dmgType`; spell `school`/`rangeType`/`areaEffectShape`/`components`/`durationType`/`durationUnit`/`activation.unit`; monster `size`/`type`/`alignment`/`damageImmunities`/`damageResistances`/`damageVulnerabilities`/`cr`, and the ability/skill keys inside `savingThrows`/`skills`) is checked against the real EncounterPlus value list. A monster's `languages`/`environments` accept either a standard value or a custom, freely-typed one — matching the real EncounterPlus form. A monster's `conditionImmunities` and a spell's `classes` aren't checked against any list at all — both reference an EncounterPlus entity MPX doesn't support yet, so they're accepted as free-form strings.
- In the built archive, empty optional fields are stripped the same way as `module.json` — including nested objects (`data`, spell `data.activation`, monster `data.speed`/`data.senses`): if everything inside one is empty, the whole object is dropped rather than kept as `{}`. A monster's `data.savingThrows`/`data.skills` are dropped the same way when they have no keys at all. Numbers and booleans are never stripped (`0`/`false` are real answers, not "unset").
- `attributes.measurement`/`attributes.ruleset` are filled in from the project's resolved defaults (see [Compendium](Compendium)) whenever a file leaves them empty/absent — so `attributes` itself is never actually empty by the time stripping happens; an entry's own explicit value is always left as-is.
- An item's, spell's, or monster's `image` (if set to a real file, not just the `items/`/`spells/`/`monsters/` placeholder) must exist in the project and is copied into the archive. A monster's `token` (its separate map-token image) is validated and copied the same way.
- A roll table's `rolls` field (an EncounterPlus-internal roll history, never authored by hand) is always dropped, and `rollMode` is omitted when it's `"normal"` (the default).
- `items.json`/`spells.json`/`tables.json`/`monsters.json` are only written to the archive when there's at least one entry.
- Items, spells, and monsters can also be authored directly inside a page's Markdown as a fenced ` ```item `/` ```spell `/` ```monster ` block, and a roll table gets auto-detected straight from a plain Markdown table (no fenced block) — every inline entry merges into the same output as the standalone files above, validated the same way. See [Compendium](Compendium) for the authoring side.

## Broken link detection

Reimplements the original Module Packer's `checkForBrokenLinks`: every page's rendered links are checked, and anything that doesn't resolve is reported as a **non-blocking warning** — the module still builds and imports fine, it's a heads-up, not an error. After a successful build, if any were found, the notification gets a "Show Broken Links" action listing them in the "MPX" output channel (same place a real build failure shows).

- A bare-slug link (e.g. `[Chapter 2](chapter-two)`) is checked against every real page/group/map/encounter slug in the module.
- A `#anchor` link (e.g. `[Jump to Introduction](#introduction)`) is checked against the real heading anchors generated on that *same* page — unlike the original Module Packer, which never actually stripped the leading `#` outside PDF export, so a same-page anchor link always misfired there (an unfinished, "temporary" feature in the original, off by default). Not yet tested against how EncounterPlus itself resolves an anchor link at runtime — treat this as informative until confirmed.
- **Never checked, deliberately**: an absolute URL (`http://`/`https://`), `mailto:`/`tel:`, a compendium reference (`/item/...`, `/spell/...`, `/monster/...`, `/roll/...`), an auto-detected roll table's own rewritten `/table-roll/...` link (see [Roll table auto-detection](Compendium#roll-table-auto-detection)), the long-form same-module page link (`/page/...` — same resolution as the bare-slug form, not worth a second check), and a cross-module link (`/module/{module-slug}/page/{page-slug}` — MPX has no way to know another module's real slugs).
