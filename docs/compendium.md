# Compendium

A "Compendium" section in the MPX sidebar, alongside [Project](Project-Panel) and [Module Explorer](Module-Explorer), for reusable game content — items, spells, and roll tables — rather than the page tree.

## How to use it

1. Run the command (palette, or the corresponding button in the Compendium panel's title bar): `MPX: Create Item`, `MPX: Create Spell`, `MPX: Create Roll Table`.
2. Enter a name. `slug` is generated automatically from it.
3. The file is created and opens automatically.
4. It appears under its category (Items / Spells / Roll Tables) in the panel, labeled by its `name` — the panel watches the folder and refreshes automatically as files are created, edited, or deleted.

If the generated slug already matches an existing file of the same type, the command fails with a clear error — nothing is overwritten.

## What gets created

- **Item** (`items/<slug>.json`): `id` (UUID), `name`, `slug`, `attributes` (`measurement`/`ruleset`), `data` (18 fields covering weapon/armor/container properties — `type`, `rarity`, `value`, `weight`, `properties`, `dmg1`/`dmg2`, etc.), `descr`, `image`, `sources`, `tags`.
- **Spell** (`spells/<slug>.json`): `id`, `name`, `slug`, `attributes`, `data` (`level`, `school`, `ritual`, `activation`, `rangeType`/`range`, `areaEffectShape`/`areaEffectSize`, `components`/`componentsDetail`, `durationType`/`duration`/`durationUnit`, `classes`), `descr`, `image`, `sources`, `tags`.
- **Roll Table** (`tables/<slug>.json`): `id`, `name`, `slug`, `columns`, `rows`, `descr`, `sources`, `tags` — no `attributes`/`data`/`image`, unlike Item and Spell.

Every field is written upfront, like `module.json` — delete whatever doesn't apply to this entry. Nothing is required beyond `id`/`name`/`slug` (see [Build Module](Build-Module) for exactly what's validated and how empty fields are handled at build time).

While editing, VSCode validates each file against its own EncounterPlus schema — autocomplete (⌃Space / ⌥Esc depending on platform), hover documentation, and red squiggles on an invalid enum value, a malformed UUID, or a badly shaped `columns`/`rows` pair.

## Mutually exclusive fields (Spell)

A spell's `rangeType` and `range` are mutually exclusive, confirmed against real EncounterPlus exports: set `rangeType` (`self`/`touch`/`sight`/`unlimited`) for a special range, or leave it unset and use `range` (feet) for a plain numeric one — never both. Similarly, `duration`/`durationUnit` only apply when `durationType` is unset (a plain timed duration) or `"concentration"`; other duration types (`instantaneous`, `special`, `dispel`, `dispelOrTrigger`) don't use them.

## Not included (yet)

- **Create Monster** button is present in the panel but not implemented yet — the next Compendium content type.
- **No inline authoring** — items/spells/monsters as fenced blocks directly inside a Markdown page, or roll tables auto-detected from a Markdown table (as the original Module Packer and old MPX both supported) — deliberately out of scope for now; standalone JSON files only.
- **No on/off toggle for roll table auto-detection** — becomes relevant once inline authoring exists (tracked in [issue #22](https://github.com/BriocheMasquee/mpx-bis/issues/22), which specifically calls out that the old MPX had this always on with no way to disable it).
- **`data.classes` on a spell isn't validated or autocompleted** against a real class list — classes aren't their own Compendium content type yet (tracked in [issue #3](https://github.com/BriocheMasquee/mpx-bis/issues/3)), so the field just accepts free-form `"ClassName|sourceCode"` strings for now.
