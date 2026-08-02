# Compendium

A "Compendium" section in the MPX sidebar, alongside [Project](Project-Panel) and [Module Explorer](Module-Explorer), for reusable game content — items, spells, roll tables, and monsters — rather than the page tree.

## How to use it

1. Run the command (palette, or the corresponding button in the Compendium panel's title bar, in this order: `MPX: Create Monster`, `MPX: Create Spell`, `MPX: Create Item`, `MPX: Create Roll Table`).
2. Enter a name. `slug` is generated automatically from it.
3. The file is created and opens automatically.
4. It appears under its category (Monsters / Spells / Items / Roll Tables — each labeled with its entry count in parentheses, e.g. "Monsters (3)") in the panel, labeled by its `name` and using the same icon as its "Create" button — the panel watches the folder and refreshes automatically as files are created, edited, or deleted.

If the generated slug already matches an existing file of the same type, the command fails with a clear error — nothing is overwritten.

Right-click an entry and choose **Delete** to remove it without leaving the panel — the file is moved to the OS trash (recoverable), after a confirmation prompt.

Both the Compendium and Module panels have a "Collapse All" button (VSCode's built-in tree action) at the end of their title bar, for quickly collapsing every expanded category/group.

## What gets created

- **Item** (`items/<slug>.json`): `id` (UUID), `name`, `slug`, `attributes` (`measurement`/`ruleset`), `data` (18 fields covering weapon/armor/container properties — `type`, `rarity`, `value`, `weight`, `properties`, `dmg1`/`dmg2`, etc.), `descr`, `image`, `sources`, `tags`.
- **Spell** (`spells/<slug>.json`): `id`, `name`, `slug`, `attributes`, `data` (`level`, `school`, `ritual`, `activation`, `rangeType`/`range`, `areaEffectShape`/`areaEffectSize`, `components`/`componentsDetail`, `durationType`/`duration`/`durationUnit`, `classes`), `descr`, `image`, `sources`, `tags`.
- **Roll Table** (`tables/<slug>.json`): `id`, `name`, `slug`, `columns`, `rows`, `descr`, `sources`, `tags` — no `attributes`/`data`/`image`, unlike the other three.
- **Monster** (`monsters/<slug>.json`): `id`, `name`, `slug`, `attributes`, `data` (`size`, `type`, `alignment`, `ac`/`hp` as free text, `speed`, `abilities`, `savingThrows`/`skills` as sparse ability/skill → bonus maps, `conditionImmunities`/`damageImmunities`/`damageResistances`/`damageVulnerabilities`, `senses`, `passivePerception`, `languages`, `cr`, `initiativeBonus`/`proficiencyBonus`, `environments`, and five feature lists — `traits`/`actions`/`bonusActions`/`reactions`/`legendaryActions`, each `{ name, text, usage? }`), `descr`, `image`, `token` (a separate map-token image), `sources`, `tags`. No `mythicActions` — confirmed to be an unused 5.5e-era leftover, omitted entirely.

Every field is written upfront, like `module.json` — delete whatever doesn't apply to this entry. Nothing is required beyond `id`/`name`/`slug` (see [Build Module](Build-Module) for exactly what's validated and how empty fields are handled at build time).

While editing, VSCode validates each file against its own EncounterPlus schema — autocomplete (⌃Space / ⌥Esc depending on platform), hover documentation, and red squiggles on an invalid enum value, a malformed UUID, or a badly shaped `columns`/`rows` pair.

## `attributes.measurement` / `attributes.ruleset`

Item/Spell/Monster's `attributes.measurement` is prefilled at creation from two project-wide VSCode settings — never stored in `module.json`, since neither is attached to the module in EncounterPlus, only to the game system:

- `mpx.contentLanguage`: `"en"` (default) or `"fr"`.
- `mpx.defaultMeasurement`: `"auto"` (default), `"imperial"`, or `"metric"`.

When left at `"auto"`, the measurement system is derived from the language — `"fr"` → `"metric"`, anything else → `"imperial"` — matching exactly how old MPX linked the two. Setting `mpx.defaultMeasurement` explicitly to `"imperial"` or `"metric"` always overrides the language-based fallback.

Run `MPX: Select Content Language` or `MPX: Select Default Measurement` (command palette) for a QuickPick instead of editing `.vscode/settings.json` by hand — each shows the current choice and writes the setting at the workspace-folder scope.

**Make this choice at the start of the project**, before creating Compendium entries. The resolved value is only ever *prefilled* — once an entry's `attributes.measurement` is written (even by this prefill), it's a real, explicit value, and neither creating new entries nor building will ever change it again. Switching `mpx.contentLanguage`/`mpx.defaultMeasurement` partway through a project only affects entries created *after* the change — every entry created before keeps its earlier value, so the Compendium ends up with a visible split between old and new entries instead of one consistent measurement system.

At build time, any item/spell/monster that still has an empty/absent `attributes.measurement` gets filled in from this same resolved value — but an entry's own explicit value, once set, is never touched. This matches how real EncounterPlus exports treat the field: genuinely per-entity, not a project-wide constant to enforce (real exports show different items with different values).

`attributes.ruleset` is currently hardcoded to `"5.5e"` everywhere (creation and build fallback alike) — there's no `mpx.ruleset` setting yet. Our schemas and templates have only been verified against real 5.5e data; supporting `"5e"` would need its own format audit first (planned once the 5.5e Compendium is complete).

The translation catalog itself (actually localizing generated labels) is a separate, larger piece of work, deliberately not part of this — only the language↔measurement link is implemented so far.

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
