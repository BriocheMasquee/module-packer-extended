# Compendium

A "Compendium" section in the MPX sidebar, alongside [Project](Project-Panel) and [Module Explorer](Module-Explorer), for reusable game content — items, spells, roll tables, and monsters — rather than the page tree.

## How to use it

1. Run the command (palette, or the corresponding button in the Compendium panel's title bar, in this order: `MPX: Create Monster`, `MPX: Create Spell`, `MPX: Create Item`, `MPX: Create Roll Table`).
2. Enter a name. `slug` is generated automatically from it.
3. The file is created and opens automatically.
4. It appears under its category (Monsters / Spells / Items / Roll Tables — each labeled with its entry count in parentheses, e.g. "Monsters (3)") in the panel, labeled by its `name` and using the same icon as its "Create" button — the panel watches the folder and refreshes automatically as files are created, edited, or deleted.

If the generated slug already matches an existing file of the same type, the command fails with a clear error — nothing is overwritten.

Both the Compendium and Module panels have a "Collapse All" button (VSCode's built-in tree action) at the end of their title bar, for quickly collapsing every expanded category/group.

## What gets created

- **Item** (`items/<slug>.json`): `id` (UUID), `name`, `slug`, `attributes` (`measurement`/`ruleset`), `data` (18 fields covering weapon/armor/container properties — `type`, `rarity`, `value`, `weight`, `properties`, `dmg1`/`dmg2`, etc.), `descr`, `image`, `sources`, `tags`.
- **Spell** (`spells/<slug>.json`): `id`, `name`, `slug`, `attributes`, `data` (`level`, `school`, `ritual`, `activation`, `rangeType`/`range`, `areaEffectShape`/`areaEffectSize`, `components`/`componentsDetail`, `durationType`/`duration`/`durationUnit`, `classes`), `descr`, `image`, `sources`, `tags`.
- **Roll Table** (`tables/<slug>.json`): `id`, `name`, `slug`, `columns`, `rows`, `descr`, `sources`, `tags` — no `attributes`/`data`/`image`, unlike the other three.
- **Monster** (`monsters/<slug>.json`): `id`, `name`, `slug`, `attributes`, `data` (`size`, `type`, `alignment`, `ac`/`hp` as free text, `speed`, `abilities`, `savingThrows`/`skills` as sparse ability/skill → bonus maps, `conditionImmunities`/`damageImmunities`/`damageResistances`/`damageVulnerabilities`, `senses`, `passivePerception`, `languages`, `cr`, `initiativeBonus`/`proficiencyBonus`, `environments`, and five feature lists — `traits`/`actions`/`bonusActions`/`reactions`/`legendaryActions`, each `{ name, text, usage? }`), `descr`, `image`, `token` (a separate map-token image), `sources`, `tags`. No `mythicActions` — confirmed to be an unused 5.5e-era leftover, omitted entirely.

Every field is written upfront, like `module.json` — delete whatever doesn't apply to this entry. Nothing is required beyond `id`/`name`/`slug` (see [Build Module](Build-Module) for exactly what's validated and how empty fields are handled at build time).

While editing, VSCode validates each file against its own EncounterPlus schema — autocomplete (⌃Space / ⌥Esc depending on platform), hover documentation, and red squiggles on an invalid enum value, a malformed UUID, or a badly shaped `columns`/`rows` pair.

## Mutually exclusive fields (Spell)

A spell's `rangeType` and `range` are mutually exclusive, confirmed against real EncounterPlus exports: set `rangeType` (`self`/`touch`/`sight`/`unlimited`) for a special range, or leave it unset and use `range` (feet) for a plain numeric one — never both. Similarly, `duration`/`durationUnit` only apply when `durationType` is unset (a plain timed duration) or `"concentration"`; other duration types (`instantaneous`, `special`, `dispel`, `dispelOrTrigger`) don't use them.

## Monster features use `text`, not `description`

`traits`/`actions`/`bonusActions`/`reactions`/`legendaryActions` entries are `{ name, text, usage? }` — confirmed against a real compiled `monsters.json` export. An earlier reading of the old MPX source (before real export data was available to check against) had assumed `{ name, description }`; that assumption was wrong and has been corrected here.

## Fields that accept a custom value alongside a standard list

A monster's `data.languages` and `data.environments` aren't strictly validated against their standard list — the real EncounterPlus form lets you type a custom entry alongside the usual options (e.g. a homebrew language or a setting-specific environment), so any string is accepted for both.

`data.cr` (challenge rating), on the other hand, **is** a closed list — confirmed against EncounterPlus's own challenge-rating-to-XP table: `0`, the three sub-1 fractions (`1/8`, `1/4`, `1/2`), then every integer from `1` to `30`.

## Not included (yet)

- **No inline authoring** — items/spells/monsters as fenced blocks directly inside a Markdown page, or roll tables auto-detected from a Markdown table (as the original Module Packer and old MPX both supported) — deliberately out of scope for now; standalone JSON files only.
- **No on/off toggle for roll table auto-detection** — becomes relevant once inline authoring exists (tracked in [issue #22](https://github.com/BriocheMasquee/mpx-bis/issues/22), which specifically calls out that the old MPX had this always on with no way to disable it).
- **`data.classes` on a spell** and **`data.conditionImmunities` on a monster** aren't validated or autocompleted against a real list — classes and conditions aren't their own Compendium content type yet (tracked in [issue #3](https://github.com/BriocheMasquee/mpx-bis/issues/3)), so both fields just accept free-form strings for now.
