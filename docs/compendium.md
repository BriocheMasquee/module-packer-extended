# Compendium

A "Compendium" section in the MPX sidebar, alongside [Project](Project-Panel) and [Module Explorer](Module-Explorer), for reusable game content — items, spells, roll tables, monsters, and backgrounds — rather than the page tree.

## How to use it

1. Run the command (palette, or the corresponding button in the Compendium panel's title bar, in this order: `MPX: Create Monster`, `MPX: Create Spell`, `MPX: Create Item`, `MPX: Create Roll Table`, `MPX: Create Background`).
2. Enter a name. `slug` is generated automatically from it.
3. The file is created and opens automatically.
4. It appears under its category (Monsters / Spells / Items / Roll Tables / Backgrounds — each labeled with its entry count in parentheses, e.g. "Monsters (3)") in the panel, labeled by its `name` and using the same icon as its "Create" button — the panel watches the folder and refreshes automatically as files are created, edited, or deleted.

If the generated slug already matches an existing file of the same type, the command fails with a clear error — nothing is overwritten.

Right-click an entry and choose **Delete** to remove it without leaving the panel — the file is moved to the OS trash (recoverable), after a confirmation prompt.

Both the Compendium and Module panels have a "Collapse All" button (VSCode's built-in tree action) at the end of their title bar, for quickly collapsing every expanded category/group.

## What gets created

- **Item** (`items/<slug>.json`): `id` (UUID), `name`, `slug`, `attributes` (`measurement`/`ruleset`), `data` (18 fields covering weapon/armor/container properties — `type`, `rarity`, `value`, `weight`, `properties`, `dmg1`/`dmg2`, etc.), `descr`, `image`, `sources`, `tags`.
- **Spell** (`spells/<slug>.json`): `id`, `name`, `slug`, `attributes`, `data` (`level`, `school`, `ritual`, `activation`, `rangeType`/`range`, `areaEffectShape`/`areaEffectSize`, `components`/`componentsDetail`, `durationType`/`duration`/`durationUnit`, `classes`), `descr`, `image`, `sources`, `tags`.
- **Roll Table** (`tables/<slug>.json`): `id`, `name`, `slug`, `columns`, `rows`, `descr`, `sources`, `tags` — no `attributes`/`data`/`image`, unlike the other three.
- **Monster** (`monsters/<slug>.json`): `id`, `name`, `slug`, `attributes`, `data` (`size`, `type`, `alignment`, `ac`/`hp` as free text, `speed`, `abilities`, `savingThrows`/`skills` as sparse ability/skill → bonus maps, `conditionImmunities`/`damageImmunities`/`damageResistances`/`damageVulnerabilities`, `senses`, `passivePerception`, `languages`, `cr`, `initiativeBonus`/`proficiencyBonus`, `environments`, and five feature lists — `traits`/`actions`/`bonusActions`/`reactions`/`legendaryActions`, each `{ name, text, usage? }`), `descr`, `image`, `token` (a separate map-token image), `sources`, `tags`. No `mythicActions` — confirmed to be an unused 5.5e-era leftover, omitted entirely.
- **Background** (`backgrounds/<slug>.json`): `id`, `name`, `slug`, `attributes`, `data` (`abilities`, `feat`, `skills`, `tools`, `equipment`), `descr`, `sources`, `tags`, `image` — a different field order than the other three (`descr`/`sources`/`tags`/`image`, not `descr`/`image`/`sources`/`tags`); the other three are tracked to be realigned to match ([issue #41](https://github.com/BriocheMasquee/module-packer-extended/issues/41)). No `languages` field — a 5e-only leftover, dropped from 5.5e's own background data model (confirmed against real 5.5e exports). Standalone file only for now — no inline `` ```background `` block authoring yet, unlike item/spell/monster.

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

`mpx.contentLanguage` also selects which catalog every generated label (school names, skill names, unit words, section titles, ...) is translated from — see [Localization](Localization) for the full catalog/override/sync design. Only static field labels and enum/automatic terms are translated this way; free-text fields (`descr`, `name`, `typeDetail`, ...) are never touched.

## Mutually exclusive fields (Spell)

A spell's `rangeType` and `range` are mutually exclusive, confirmed against real EncounterPlus exports: set `rangeType` (`self`/`touch`/`sight`/`unlimited`) for a special range, or leave it unset and use `range` (feet) for a plain numeric one — never both. Similarly, `duration`/`durationUnit` only apply when `durationType` is unset (a plain timed duration) or `"concentration"`; other duration types (`instantaneous`, `special`, `dispel`, `dispelOrTrigger`) don't use them.

## Monster features use `text`, not `description`

`traits`/`actions`/`bonusActions`/`reactions`/`legendaryActions` entries are `{ name, text, usage? }` — confirmed against a real compiled `monsters.json` export. An earlier reading of the old MPX source (before real export data was available to check against) had assumed `{ name, description }`; that assumption was wrong and has been corrected here.

## Fields that accept a custom value alongside a standard list

A monster's `data.languages` and `data.environments` aren't strictly validated against their standard list — the real EncounterPlus form lets you type a custom entry alongside the usual options (e.g. a homebrew language or a setting-specific environment), so any string is accepted for both. `data.environments` isn't rendered on the card at all (matching real books — it's app-only metadata, not printed stat block content). `data.languages` **is** rendered, and each entry is translated against the catalog's `Language.*` namespace when `mpx.contentLanguage` is `"fr"` (e.g. `Common` → `Commun`) — a value with no matching catalog entry (a homebrew language, or "All") renders exactly as typed, untranslated.

`data.cr` (challenge rating), on the other hand, **is** a closed list — confirmed against EncounterPlus's own challenge-rating-to-XP table: `0`, the three sub-1 fractions (`1/8`, `1/4`, `1/2`), then every integer from `1` to `30`.

A background's `data.abilities` and `data.skills` follow the exact same convention — any string is accepted alongside the standard ability/skill list. Unlike monster's `languages`/`environments` (free text with no schema-level suggestions), these two fields' JSON schema pairs the standard list with an unrestricted string branch (`anyOf`), so VSCode's Ctrl+Space/⌃Space completion suggests the standard values while still accepting a custom one without a validation error. `data.tools` has no standard list at all (EncounterPlus itself has no fixed tool catalog) — it's plain free text, one entry per string, no completion. A background has no `data.languages` field at all — a 5e-only field, dropped from 5.5e's own background data model.

## Background's `data.feat` is a single string, not a list

Confirmed against a real `backgrounds.json` export: a background grants exactly one origin feat, authored as a plain string (e.g. `"Magic Initiate (Cleric)"`), not an array — even though the adjacent `abilities`/`skills`/`tools` fields are all arrays. `data.equipment` is also a single free-text string (the "Choose A or B" starting-equipment blurb) and supports Markdown, same as `descr`.

## Inline spell authoring

A spell can also be written directly inside a page's Markdown, as a fenced ` ```spell ` YAML block, instead of (or alongside) a standalone `spells/<slug>.json` file. Spells, items, and monsters (see "Inline item authoring"/"Inline monster authoring" below) support this fenced-block style of inline authoring; a roll table instead gets auto-detected straight from a plain Markdown table, no fenced block needed — see [Roll table auto-detection](#roll-table-auto-detection). Spell and item share the same `.compendium-block` CSS (top border, fonts, title) — only the detail lines and field set differ. Monster uses a separate, older `.statblock` CSS system instead (see "Inline monster authoring") — visually unrelated to `.compendium-block`.

### YAML shape

The block is "flat" (no `data:` wrapper, unlike the standalone JSON files) for ease of authoring — it's reshaped internally into the same envelope before validation and before merging into `spells.json`. Type `mpx-spell` in a page and accept the suggestion (press `Ctrl+Space`/`⌃Space` first if it doesn't pop up on its own) to insert the full template:

```
```spell
name: "New Spell"
slug: new-spell
attributes:
  measurement: ""
  ruleset: "5.5e"
image: "spells/"
showImage: true
level: 0
school: ""
showSchoolIcon: true
ritual: false
activation:
  time: 0
  unit: ""
  condition: ""
rangeType: ""
range: 0
areaEffectShape: ""
areaEffectSize: 0
showAreaEffectIcon: true
components: []
componentsDetail: ""
durationType: ""
duration: 0
durationUnit: ""
classes: []
descr: ""
sources:
  - name: ""
    page: 0
showSources: true
tags: []
showTags: true
```
```

Free-text/enum fields (`name`, `school`, `activation.unit`, `rangeType`, `durationType`, `durationUnit`, `descr`) are quoted by default so an untouched field parses as an empty string, not YAML `null` — a `null` there would fail the same enum validation a typo would. `range`/`areaEffectSize` default to `0`, which is treated as "not set" everywhere (0 is never a real spell range or area size in D&D's rules) rather than rendering a literal "0 feet". `image: "spells/"` (no file name) is likewise treated as "no image", the same convention a standalone spell file uses.

`slug` is optional — if left out, it's generated from `name` at build time. `id` isn't part of the template at all; a deterministic UUID (from the slug + module id) is generated automatically, exactly like a page's id, so nothing needs to be typed by hand.

### `show*` toggles

Every visual element — the illustration image, the school icon, the area-effect shape icon, the Source line, the Tags line — has its own `show*` boolean, placed directly under the field it controls. Each also has a project-wide default setting:

- `mpx.defaultShowSpellImage`
- `mpx.defaultShowSpellSchoolIcon`
- `mpx.defaultShowSpellAreaEffectIcon`
- `mpx.defaultShowSpellSources`
- `mpx.defaultShowSpellTags`

All default to `true`. A spell's own `show*` field, once explicitly set to `true` or `false`, always wins over the project setting — the project setting only fills in when the field is left out of the YAML entirely. `createModuleProject` prefills all five in `.vscode/settings.json`, same as `mpx.contentLanguage`/`mpx.defaultMeasurement`.

### Icons

The school icon (`showSchoolIcon`) and the area-effect shape icon (`showAreaEffectIcon`) come from the theme's own bundled images (`assets/img/school-*.webp`, `assets/img/shape-*.webp`), matching EncounterPlus's real rendering. A shape with no matching icon (there isn't one for every `areaEffectShape` value) falls back to its translated text label instead of leaving a blank spot — same behavior as turning the icon off with the `show*` field.

### Sources

`sources` is an array of `{ name, page }` objects, same shape as a standalone spell file's — `page` is a number, not a string:

```yaml
sources:
  - name: "Player's Handbook"
    page: 241
```

### Measurement

`range` and `areaEffectSize` are always authored in feet — when the resolved measurement system is metric, the displayed number is converted using the same simplified factor WotC's own licensed French translations use (feet × 0.3, rounded to the nearest half-unit), not the precise 0.3048 conversion. `range`'s plain unit word switches to "mètre" when both the measurement is metric and `mpx.contentLanguage` is `"fr"` — an MPX-authored word, not from the catalog (EncounterPlus has no key for it) — see [Localization](Localization).

The live preview re-resolves `mpx.defaultMeasurement`/`mpx.contentLanguage`/the five `defaultShowSpell*` settings on every render and refreshes itself automatically when any of them changes — no need to reload the Extension Development Host or reopen the preview.

### Build merge

At build time, every inline spell across every page is merged into `spells.json` alongside standalone files — validated exactly like a standalone file (slug format, enum values, `sources`/`tags` shape, image existence), with the same duplicate-slug/duplicate-id detection applying across *both* sources. The `show*` fields never appear in the built `spells.json` — they're an inline-authoring/rendering concern only, not part of EncounterPlus's own schema, so they're stripped before merging.

### Compendium panel entry

An inline spell/item/monster shows up in the Compendium panel's "Spells"/"Items"/"Monsters" category alongside standalone files, sorted together by name, labeled "inline" — same icon as a standalone entry, since the label already distinguishes it. Clicking it doesn't open a file (there isn't a separate one) — it opens the page and reveals the block's location instead.

### A missing closing fence

Forgetting the closing ` ``` ` on a spell/item/monster block causes its content to swallow everything after it, including the next block's own opening fence line, as literal (invalid) YAML text. The resulting error hints at this specifically (e.g. "A previous ```monster block above this one is likely missing its closing ``` line") rather than just surfacing the raw YAML parser error.

## Inline item authoring

Same mechanism as inline spells (see above) — a fenced ` ```item ` YAML block, standalone `items/<slug>.json` fallback, `mpx-item` snippet (`Ctrl+Space`/`⌃Space` if it doesn't pop up on its own):

```
```item
name: "New Item"
slug: new-item
attributes:
  measurement: ""
  ruleset: "5.5e"
image: "items/"
showImage: true
type: ""
typeDetail: ""
rarity: ""
attunement: false
attunementDetail: ""
value: 0
weight: 0
ac: 0
str: 0
stealth: false
properties: []
mastery: ""
dmg1: ""
dmg2: ""
dmgType: ""
range: ""
container: false
capacity: 0
descr: ""
sources:
  - name: ""
    page: 0
showSources: true
tags: []
showTags: true
```
```

Differences from the spell block worth calling out:

- **No school/area-effect icon equivalent** — an item has no theme-provided icon set, so only three `show*` toggles exist: `showImage`, `showSources`, `showTags` (project defaults: `mpx.defaultShowItemImage`, `mpx.defaultShowItemSources`, `mpx.defaultShowItemTags`).
- **The illustration image renders last**, after Source/Tags, rather than at the top like a spell's — an explicit design choice (an item's image is a "nice to have", not its focal point). The `showImage` field still sits directly under `image:` in the YAML, matching the usual `show*`-below-its-field convention; only the *rendered* position differs.
- **Subtitle** combines `type` (+ `typeDetail` in parens) and `rarity`, e.g. "Melee Weapon, Legendary". `type: custom` is a special case (no such entry in the catalog) and falls back to "Custom".
- **Weight/capacity have no unit conversion** — unlike a spell's `range`/`areaEffectSize` (always feet, converted to meters), an item's `weight`/`capacity` are authored directly in whichever unit the project's resolved measurement implies (kg if metric, lb if imperial) and just labeled accordingly. There's no single canonical unit to convert from the way D&D's rules fix spell ranges in feet.
- **`weight`/`value`/`ac`/`str` of `0` are treated as "not set"**, same convention as a spell's `range: 0`/`areaEffectSize: 0`.
- **`attunement`/`stealth` render as standalone flag lines** ("Requires Attunement (detail)", "Stealth Check Disadvantage") rather than label:value pairs — there's no natural "value" for a boolean with no text of its own.
- **No "Ability"/"Utilize"/"Craft" fields** — these appear on official rules-reference cards for tools (e.g. D&D Beyond, EncounterLog) but aren't part of EncounterPlus's own item schema (confirmed against two real exhaustive item exports); a homebrew tool authored via MPX describes that information as prose in `descr` instead. This is an accepted compromise, not a bug — the rendered card won't be pixel-identical to those reference sites for tools specifically.

## Inline monster authoring

A fenced ` ```monster ` YAML block, standalone `monsters/<slug>.json` fallback, `mpx-monster` snippet — same mechanism as spell/item, but a **different CSS system**: `.statblock`, ported directly from EncounterPlus's own real stat block rendering (it predates this feature — the CSS already existed in the theme, unused, before anything generated matching HTML for it). Confirmed against several real 2024 Monster Manual stat blocks (Arch-Hag, Aboleth, Aarakocra, Young White Dragon).

```
```monster
name: "New Monster"
slug: new-monster
attributes:
  measurement: ""
  ruleset: "5.5e"
image: "monsters/"
showImage: true
token: "monsters/"
showToken: true
size: ""
type: ""
typeDetail: ""
alignment: ""
ac: "0"
hp: "0"
speed:
  walk: 30
  burrow: 0
  climb: 0
  fly: 0
  hover: false
  swim: 0
  other: ""
abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
savingThrows: {}
skills: {}
damageVulnerabilities: []
damageResistances: []
damageImmunities: []
conditionImmunities: []
senses:
  blindsight: 0
  darkvision: 0
  tremorsense: 0
  truesight: 0
  other: ""
passivePerception: 10
languages: []
cr: ""
initiativeBonus: 0
proficiencyBonus: 2
environments: []
traits:
  - name: ""
    text: ""
actions:
  - name: ""
    text: ""
bonusActions:
  - name: ""
    text: ""
reactions:
  - name: ""
    text: ""
legendaryActions:
  - name: ""
    text: ""
descr: ""
sources:
  - name: ""
    page: 0
showSources: true
tags: []
showTags: true
```
```

### `color` / two-column — a fence class annotation, not a YAML field

Unlike everything else on this page, color and the two-column print layout aren't YAML fields at all — they're a class annotation on the fence itself, the same ` {.class} ` syntax an image caption (`{.caption}`) or a blockquote variant (`{.paper}`) already uses elsewhere in MPX:

```
```monster {.blue .two-column}
name: "New Monster"
...
```
```

- One of `blue`, `green`, `red`, `yellow`, `orange`, `gray`, `purple`, `teal`, `magenta`, `signature` (the CSS's own default) — an unrecognized value is ignored.
- `.two-column` adds the theme's two-column print layout. **Never auto-applied** — the user opts in explicitly per monster; there's no length/complexity heuristic deciding it automatically.

Neither ever reaches `monsters.json` — matching every other presentation-only concern on this page, EncounterPlus's own schema has no such fields.

### `show*` toggles

Four toggles: `showImage`, `showToken`, `showSources`, `showTags` (project defaults: `mpx.defaultShowMonsterImage`, `mpx.defaultShowMonsterToken`, `mpx.defaultShowMonsterSources`, `mpx.defaultShowMonsterTags`) — no icon toggle, same as item. `token` (circular portrait, top-right) and `image` (full-width illustration, bottom) are independent fields/toggles, matching the two separate image-like fields EncounterPlus already gives a monster.

### Source / Tags render outside the card

Unlike every other property line (rendered inside the `.statblock` card, in the theme's own style), Source and Tags render as a **separate block right after the card**, in the same shared `.compendium-block-details-footer` style spell/item use — an explicit design choice, not something EncounterPlus itself does for a real monster card.

### Measurement

`speed` (`walk`/`burrow`/`climb`/`fly`/`swim`) and `senses` (`blindsight`/`darkvision`/`tremorsense`/`truesight`) are always authored in feet and converted the same way a spell's `range`/`areaEffectSize` are — the WotC-style simplified factor (feet × 0.3, rounded to the nearest half-unit), not the precise 0.3048 conversion.

### Ability scores and saving throws

`abilities` always renders all six scores once the object is present at all (each missing individual score defaults to 10, the SRD baseline) — split into a "physical" row (STR/DEX/CON) and "mental" row (INT/WIS/CHA), matching the theme's own CSS split. Each ability's save defaults to its plain modifier; `savingThrows` is a sparse `{ ability: bonus }` map (only the abilities the monster is actually proficient in), and **a Saving Throws property line only appears when at least one listed value diverges from the plain modifier** — exactly mirroring the official stat block convention of only listing saves worth calling out.

### Challenge rating and XP

`cr` (validated against EncounterPlus's own closed `ChallengeRatingToXP` list) renders as "Challenge {cr} (XP {n}; PB +{proficiencyBonus})" — the XP number comes from the standard, universal 5e CR→XP table (fixed and deterministic, confirmed against three real stat blocks: CR 21 → 33,000 XP, CR 10 → 5,900 XP, CR 6 → 2,300 XP), not stored data. **The "or X XP in lair" variant some published monsters show is not included** — that's monster-specific flavor text, not something EncounterPlus's schema stores, so there's no data to derive it from.

### Accepted compromises

- **No auto-generated "Legendary Action Uses: N..." intro paragraph** before the Legendary Actions list — the real books insert this boilerplate automatically (referencing the monster's own name and a legendary-action-count field EncounterPlus's schema doesn't have), so it isn't generated. Add it yourself as free text in `descr`, or as the first `legendaryActions` entry, if wanted.
- **`languages` always joins with `, `** — the official books sometimes separate a trailing "telepathy N ft." note with a semicolon instead. Minor cosmetic difference, not worth a special case for one entry format.
- **A found-and-fixed pre-existing theme bug**: the ability table's floating "SAVE" column header was hardcoded to the French "JdS" in the theme's own CSS regardless of `mpx.contentLanguage` — corrected to always show "SAVE", with a `.statblock.lang-fr` CSS override switching it back to "JdS" only when the monster block is actually rendered in French (see [Localization](Localization)).
- **A found-and-fixed layout bug**: `descr`'s caption above the card (`.statblock-description`) used to be absolutely positioned over a fixed-height reserved margin on `.statblock` itself — any `descr` longer than about one line overflowed that margin and overlapped whatever content preceded the block. It now renders as a normal in-flow paragraph immediately before the card, so it pushes content down instead of overlapping it, regardless of length.

## Roll table auto-detection

A page's Markdown table becomes a roll table at build time on its own — no fenced block, no separate `tables/<slug>.json` file needed — reimplementing what the original Module Packer and old MPX both supported. The `mpx-roll-table` [snippet](Snippets) scaffolds the syntax below, but nothing about detection itself requires it — a table written entirely by hand works the same way. Detection heuristic: the header's first cell links to `/roll/...` (the dice notation, e.g. `[2d6](/roll/2d6)` — the destination itself is never followed, only its `/roll/` prefix matters):

```
## Encounter Table {.table-title}

|[2d6](/roll/2d6)|Encounter|
|:---:|:---|
|2-3|3 Kobolds|
|4-5|2 Owlbears|
|6-8|10 Giant Rats|
|9-10|1 Vampire|
|11-12|1 Tarrasque|
```

- **Name/slug** default to `"{page name} — {result column headers}"` / `{page-slug}-{that text, slugified}`, with a `(2)`/`(3)`... suffix on a same-page collision. A heading *or plain paragraph* placed right above the table (anywhere before it, as long as no other heading/paragraph comes between) carrying a `{.table-title}` class overrides this entirely — its own text becomes the table's full name, and it still renders normally on the page. `.table-title` is a real theme CSS class (small-caps, no border), not something new introduced for this — `## Encounter Table {.table-title}` and plain `Encounter Table{.table-title}` both work.
- **`{.no-repeat}`/`{.each-row}`** immediately after the roll link select `rollMode` (`noRepeat`/`eachRow`), same as a standalone table's `rollMode` field — the marker itself never leaks into the rendered link.
- **Build merge** works exactly like an inline spell/item/monster block: every detected table across every page merges into `tables.json` alongside standalone files, validated the same way (columns/rows shape, `rollMode` enum), with duplicate-slug/duplicate-id detection applying across both sources. Unlike spells/items/monsters, an inline table never carries an explicit `id` — it's always derived from its slug.
- **Compendium panel entry** — a detected table shows up in the "Roll Tables" category alongside standalone files, same as an inline spell/item/monster; clicking it reveals the table's location in the page.
- **Preview-only caption** — the live preview shows a small caption ("Detected as roll table — `{slug}`", localized to French when `mpx.contentLanguage` is `"fr"`) right under a detected table, so it's obvious at a glance which tables will end up in `tables.json`. Purely an editor affordance — never part of the built `.module`.
- **Two back-to-back tables need two blank lines between them**, not one — `markdown-it-multimd-table`'s own "multibody" feature merges tables separated by exactly one blank line into a single table with multiple `<tbody>` sections (a pre-existing renderer behavior, unrelated to roll table detection specifically, but easy to trip over when authoring two roll tables right after each other).
- **`mpx.autoDetectRollTables`** (project setting, default `true`) turns this off entirely when set to `false` — a table with a `/roll/...` header link then renders as a completely plain table (link untouched, no `tables.json` entry, no preview caption, nothing listed in the Compendium panel). The old MPX had this always on with no way to disable it; the original Module Packer's own opt-in equivalent was a `create-roll-tables: true` field in `Module.yaml` — this project instead defaults to on (matching what most authors coming from old MPX expect) with an explicit opt-out.

## Editing assistance for inline blocks

While editing a ```spell/```item/```monster block, VSCode's Markdown editor provides:
- **Field-name completion** — on a blank line, or a line where a key name is only partially typed (e.g. `sa` while typing `savingThrows`), suggests every valid top-level YAML key for that block type. Nested under a known container field, suggests only *that* field's own children instead of the block's top-level fields — authored either as indented multi-line YAML (`attributes:` on its own line, children indented below) or as a single-line `{ ... }` (e.g. the snippet's own `skills: {}`/`savingThrows: {}` defaults — completion works inside the still-open brace the same way, one `{ }` level deep):
  - `attributes:` → `measurement`/`ruleset` (spell, item, monster)
  - a spell's `activation:` → `unit`/`time`
  - a monster's `abilities:`/`savingThrows:` → the six ability keys (`str`/`dex`/`con`/`int`/`wis`/`cha`)
  - a monster's `skills:` → every skill name (`perception`, `stealth`, ...)

  A monster's `speed:`/`senses:` aren't covered yet — nested under either one, completion abstains rather than falling back to the top-level list.
- **Enum-value completion** — right after a known field's `:` (e.g. `school:`, `type:`, `alignment:`, `rarity:`, `cr:`, or an array field like `damageResistances:`), suggests its valid values. This covers every scalar/array enum field, plus the nested fields above that have their own value list (`attributes.measurement` is `imperial`/`metric` — never `auto`, which is only a valid *setting* value, not something an individual entry ever stores; `attributes.ruleset` is always `5.5e`; a spell's `activation.unit` gets the activation-unit list). Ability/skill values are plain numbers, so only their key names are completed, not a value list. `languages`/`environments` also suggest a list now (EncounterPlus's own internal enum-to-catalog-key map confirms both are backed by a real standard list, always alongside a custom/homebrew value) — see [Fields that accept a custom value alongside a standard list](#fields-that-accept-a-custom-value-alongside-a-standard-list).
- **Live diagnostics** — the same validation `Build Module` and the rendered preview's error message already run (`validateSpellData`/`validateItemData`/`validateMonsterData`) also shows up as an editor warning on the block's opening fence line, without needing the preview open. Only checked once the block has its closing ` ``` ` — a block still being typed isn't flagged as broken mid-edit.

Completion only re-triggers on `:` (right after a field name) and `[` (entering an inline array) — not on every space — so it stays out of the way while composing free text like `descr`.

The extension also ships two markdown-scoped editor defaults (`configurationDefaults` in `package.json`, each overridable by an explicit user/workspace setting):
- `editor.wordBasedSuggestions: "off"` — VSCode's own built-in word-based suggestions (any word already typed elsewhere in the document, offered as a completion regardless of context) run independently of the completion described above and can't be selectively suppressed inside just a Compendium block, so free-text fields like `descr`/`typeDetail` were getting an irrelevant word list on every keystroke.
- `editor.quickSuggestions: { other: true, comments: true, strings: true }` — a generic fenced code block's content is classified as a "string" scope by VSCode's markdown grammar, where `strings` quick-suggestions are off by default; without this, field-name completion on a blank line (e.g. picking which ability key to type under `savingThrows:`) never opens automatically — only the `:`/`[`-triggered enum-value completion does, since registered trigger characters bypass this scope restriction on their own.

Both reuse the exact same field-name/enum-value lists and validators the renderer and `Build Module` already use (`core/src/spellCompendium.ts`/`itemCompendium.ts`/`monsterCompendium.ts`, `parseSpellBlock`/`parseItemBlock`/`parseMonsterBlock`), so this can't drift out of sync with what actually builds.

## Not included (yet)

- **No "virtual entry" edit/delete from the Compendium panel** — an inline spell/item/monster's entry (and an auto-detected roll table's) reveals its location in the page; renaming or removing it means editing the page's Markdown directly, not a panel action.
- **`data.classes` on a spell** and **`data.conditionImmunities` on a monster** aren't validated or autocompleted against a real list — classes and conditions aren't their own Compendium content type yet (tracked in [issue #3](https://github.com/BriocheMasquee/module-packer-extended/issues/3)), so both fields just accept free-form strings for now.
- **No completion/diagnostics for page front matter** (`name`/`slug`/`rank`/`parent`) — deliberately not planned (closed as not wanted, see former issue #1); front-matter mistakes are still caught at `Build Module` time.
- **No completion for a monster's `speed`/`senses`** nested fields — every other nested object field (`attributes`, a spell's `activation`, a monster's `abilities`/`savingThrows`/`skills`) is covered, see [Editing assistance for inline blocks](#editing-assistance-for-inline-blocks).
- **No inline `` ```background `` block authoring** — unlike item/spell/monster, a background can currently only be authored as a standalone `backgrounds/<slug>.json` file. No card rendering (`.compendium-block` or otherwise) exists for it yet either.
