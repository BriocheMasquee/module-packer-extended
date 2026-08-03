# Localization

`mpx.contentLanguage` (`"en"` default, or `"fr"`) selects which catalog every generated label — school names, skill names, unit words like "Hour"/"Hours", section titles, "Source"/"Tags", ... — is translated from, wherever the Markdown renderer or `Build Module` produce one (inline `spell`/`item`/`monster` blocks, standalone Compendium file preview text). Run `MPX: Select Content Language` (command palette) for a QuickPick instead of editing `.vscode/settings.json` by hand.

**Only static field labels and enum/automatic terms are translated.** Free-text fields — a spell/item/monster's own `descr`, `name`, `typeDetail`, and similar — are never passed through the catalog; they render exactly as authored, in whichever language you wrote them.

## Where the catalog comes from

`core/src/catalogEn.ts` and `core/src/catalogFr.ts` are sourced from EncounterPlus's own official localization files ([`lang/en.json`](https://github.com/encounterplus/dnd5e/blob/main/lang/en.json) / [`lang/fr.json`](https://github.com/encounterplus/dnd5e/blob/main/lang/fr.json) in `encounterplus/dnd5e`), MIT licensed — confirmed directly with the EncounterPlus developer. Each is a flat `"Namespace.Key": "value"` map, with a handful of `{ one, many }` pluralized entries (e.g. `Unit.Hour`).

Two upstream issues are corrected on ingestion, not left as-is:
- A trailing-comma JSON syntax error at the end of the real `fr.json`.
- A key-name mismatch: `fr.json` has `Item.ContainerCapacityWithUnit`, `en.json` has `Item.ContainerCapacity` — renamed on ingestion so both catalogs share one lookup key.

Six `fr.json` entries EncounterPlus itself marks `"(à traduire)"` (untranslated, all vehicle/asset-related — unused by MPX today) are kept exactly as EncounterPlus ships them, not translated by us.

### Keeping the catalogs current

`.github/workflows/sync-catalogs.yml` runs roughly every two weeks (`schedule` + `workflow_dispatch` for a manual run), re-fetches both upstream files via `scripts/sync-catalogs.mjs`, regenerates `catalogEn.ts`/`catalogFr.ts` and `extension/resources/schemas/translation-overrides.schema.json` (see below), and opens a pull request with whatever changed. **It only ever opens a PR — it never merges.** A human reviews the diff (new/removed/changed keys) and merges by hand.

Run `node scripts/sync-catalogs.mjs && node scripts/generate-overrides-schema.mjs` locally to do the same refresh outside the schedule.

## Overriding a specific label

A project can rename any single catalog key's displayed word — in either language — without forking the extension's own bundled catalog, via a `translation-overrides.json` file at the project root:

```json
{
  "fr": {
    "Skill.Perception": "Vigilance"
  }
}
```

This changes what `Skill.Perception` displays **everywhere that key is looked up in the project**, not just one specific monster's `skills` entry — every monster with `perception` in its `skills` map now shows "Vigilance +N" instead of "Perception +N" when previewed or built in French. It's a catalog-key-level rename, not a per-entity setting; a YAML enum value like `perception` and the catalog lookup key `Skill.Perception` it resolves to are two different things (see [Compendium](Compendium) for the enum fields themselves).

An override entry can be a plain string, or (for a pluralized key like `Unit.Hour`) a `{ "one": "...", "many": "..." }` object, same shape as the catalog itself.

**Never bundled into the built `.module`** — `translation-overrides.json` is a local authoring aid, excluded the same way `.DS_Store` is (see `core/src/fileScan.ts`), on top of already living outside every folder the build actually scans.

### Getting started with overrides

Three ways to create/discover the file, all equivalent:
- **`MPX: Create Translation Overrides File`** (command palette) — creates it (a `{ "en": {}, "fr": {} }` skeleton) if it doesn't exist yet, and opens it either way.
- The **Project panel**'s **Translation Overrides** line — shows the current override count once the file exists, or "Create…" beforehand; clicking does the same thing as the command above (see [Project Panel](Project-Panel-Section)).
- Editing the file directly also gets **autocomplete and hover documentation** for all ~550 known catalog keys, each showing its current official value — powered by `extension/resources/schemas/translation-overrides.schema.json`, matched to the file by name via the extension's `jsonValidation` contribution (same mechanism `module.json`/`spells/*.json`/etc. already use). An override key that isn't in the schema yet (e.g. one EncounterPlus added since the schema was last generated) is still accepted at build/preview time — the schema only affects editor autocomplete, not validation.

A malformed entry (wrong type, unrecognized language) is skipped with a warning notification rather than discarding the whole file — one typo doesn't cost you every other override you've already set up.

### Resetting

Right-click the **Translation Overrides** line in the Project panel and choose **Delete** (moves the file to the OS trash) — the same generic delete action every other Project-panel entry has. No separate "reset" command or extra tree row: deleting the file is the reset, and the panel falls back to its "Create…" state on its own once the file watcher notices it's gone.

## Measurement stays a separate setting

`mpx.defaultMeasurement`/`mpx.contentLanguage` already interact for unit *conversion* (feet → meters) — see [Compendium](Compendium#measurement). That link is unrelated to label translation: switching `mpx.contentLanguage` changes both the catalog labels *and* (via the existing `"auto"` fallback) the default measurement system, but you can still pick French labels with imperial units, or English labels with metric, by setting `mpx.defaultMeasurement` explicitly.

## MPX-authored words (not from the EncounterPlus catalog)

A few labels aren't in EncounterPlus's own catalog at all, so they're handled directly in code rather than through `catalogEn.ts`/`catalogFr.ts` — meaning `scripts/sync-catalogs.mjs` never touches them:

- **A spell's `range` unit word** — `core/src/compendiumBlock.ts`'s `distanceUnitWord()` shows "mètre" when both the measurement is metric and the language is French, "meters"/"feet" otherwise. Only the metric+French word is translated (French projects default to metric — see [Compendium](Compendium#measurement)); the imperial word stays "feet" even when `mpx.contentLanguage` is `"fr"`, since that combination requires overriding `mpx.defaultMeasurement` explicitly and no French word has been set for it. A monster's speed/senses use the shorter "ft"/"m" abbreviations instead (unaffected — "m" already reads the same in both languages).
- **The ability table's floating "SAVE" column header** (5.5e theme CSS) — a static `content:` property, so it can't read `mpx.contentLanguage` directly. `renderMonsterBlockHtml` adds a `lang-fr` class to `.statblock` when the language is French, and `.statblock.lang-fr ... ::before { content: 'JdS'; }` in `global.css` overrides it — casing matched exactly ("JdS", not "JDS"/"jds").
- **Weight units ("lb"/"kg")** need no such handling — they're already tied purely to the measurement system, not the language, so "kg" already shows whenever the project is metric, in either language.

## French word order and grammatical gender

Translating each word individually isn't enough — French phrases the spell heading, monster subtitle, and item rarity differently from English, confirmed against real 5.5e French SRD text (spell/item entries, monster stat blocks). This only applies when `mpx.contentLanguage` is `"fr"`; English keeps its original phrasing.

**Spell heading** — school comes *before* the level, not after, and a cantrip reads "{École} mineur(e)":
- English: `Level 2 Abjuration` / `Evocation Cantrip`
- French: `Abjuration du 2e niveau` / `Évocation mineure`

"mineur"/"mineure" and the ordinal ("1er niveau", "2e niveau", ...) are MPX-authored (`spellBlock.ts`'s `SPELL_SCHOOL_FEMININE`/`ordinalFr`), not catalog data.

**Monster subtitle** — type comes before size, and size is a letter code, not a spelled-out word:
- English: `Large Fey, Neutral Evil`
- French: `Fée de taille G, Chaotique Mauvaise`

Size letters (`monsterBlock.ts`'s `FR_SIZE_LETTERS`, MPX-authored): T→TP, S→P, M→M, L→G, H→TG, G→Gig. "C" (Colossal) has no French code — it isn't a real 5.5e size, so it's left unmapped rather than guessed.

**Grammatical gender agreement** — several French adjectives change spelling to agree with the grammatical gender of the noun they describe:
- A monster's alignment word (`monsterBlock.ts`'s `MONSTER_TYPE_FEMININE` + `feminizeFrenchAlignment()`): "Chaotique Mauvais" (masculine, e.g. Fiélon) vs "Chaotique Mauvaise" (feminine, e.g. Monstruosité); "Non aligné" vs "non alignée". "Chaotique"/"Neutre" don't change.
- An item's "Courant"/"Peu courant" rarity (`itemBlock.ts`'s `ITEM_TYPE_FEMININE`): "Peu courant" (masculine, e.g. Anneau) vs "Peu courante" (feminine, e.g. Arme). Every other rarity word ("Rare", "Très rare", "Légendaire", "Artefact") is already gender-invariant in French.
- A cantrip's "mineur"/"mineure" (`spellBlock.ts`'s `SPELL_SCHOOL_FEMININE`): agrees with the school's own name ("Nécromancie mineure" vs "Enchantement mineur").

These three gender tables are MPX-authored (standard French grammatical gender, cross-checked against real screenshots) — not sourced from the EncounterPlus catalog, which has no gender data and only ever provides the fixed masculine form.
