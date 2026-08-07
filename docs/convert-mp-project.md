# Convert MP Project

Converts a Module Packer V4 ("MP") **source project folder** — `Module.yaml`, Markdown pages, `Group.yaml` subfolders, `assets/` — into a new MPX V5 project folder, ready to build.

Scope: MP project folders only. A `.module` (or `.mpmodule`) file already built by MP is not a supported source — see [Not included (yet)](#not-included-yet).

Conversion means moving to the EncounterPlus V5 *file format* (XML/YAML → JSON), not to the current 5.5e ruleset's vocabulary: original CSS/assets/layout are kept as-is (except where a feature no longer exists technically, e.g. `markdown-it-decorate` syntax — see below), and MP's own functionality is preserved rather than modernized.

## How to use it

Two equivalent entry points:

1. **Sidebar welcome view**: before opening any folder, or after opening an empty folder, the [Project section](Project-Panel) shows a "Convert MP Project to MPX" link next to "Create Module Project".
2. **Command palette**: run `MPX: Convert MP Project to MPX`.

Either way: pick the MP project folder to convert (must contain a `Module.yaml`, though a missing one only produces a notice — see below), then pick an **empty** destination folder for the converted MPX project. The destination can't be inside the source project. Progress shows in a notification; when it's done, a summary message offers an "Open Converted Project" button.

Every notice the conversion produced (see the tables below) is listed in the "MPX" output channel — same channel `MPX: Build Module` uses.

## What gets created

- `module.json` — same shape [Create Module Project](Create-Module-Project) produces. `id`: MP's own `id` if it's a valid UUID, uppercased; otherwise a fresh v4 UUID. `name`/`slug`/`descr`/`category`/`author` come from `Module.yaml`'s `name`/`slug`/`description`/`category`/`author`; `acronym` from `code`. `version` is MP's own `version`, coerced to a string (not normalized to semver). The cover image (`Module.yaml`'s `cover`) is copied to the project root (or left under `images/` if it was already there) and referenced accordingly.
- `pages/*.md` — one per MP page (or per `module-pagebreaks` split — see below), front matter rebuilt as `name`/`slug`/`rank`/`parent`. Page content is copied through, then run through the blockquote-decoration rewrite, the compendium block reshape, and an image-path rewrite (see below).
- `groups/*.json` — one per MP subfolder that declares its own `Group.yaml` (see [Groups](#groups) below).
- `maps/*.json`+`.zip`, `encounters/*.json`+`.zip` — one pair per `Module.yaml` `maps:`/`encounters:` entry (see [Maps and encounters](#maps-and-encounters) below).
- `images/` — every image actually referenced from a page's Markdown (`![...](...)` or `<img src="...">`), copied in flat (by base file name).
- `assets/` — MP's own `assets/` folder, copied through verbatim (CSS, fonts, JS — nothing rewritten) if the project has one. Whatever it doesn't already have `assets/css/global.css` in — whether it has no `assets/` at all, or one that never carried a base theme of its own (just a `custom.css`, say) — is filled in from **Module Packer V4's own bundled default theme** (not MPX's own `5.5e` theme — see `THIRD-PARTY-LICENSES.md` for where it comes from), copied verbatim, additively, never overwriting a file the project's own `assets/` already had (so an existing `custom.css` is untouched). Reported with a `fallback-theme` notice.
- `.vscode/settings.json` — the same defaults [Create Module Project](Create-Module-Project) writes, except `mpx.contentLanguage` and `mpx.autoDetectRollTables` are derived from the MP project itself (see below) rather than fixed.

## Module-level detection

- **Content language** (`mpx.contentLanguage`): guessed from `Module.yaml`'s `description` text — a French accented-letter check, falling back to a French stop-word count (≥ 2 matches) — since MP has no dedicated language field. Defaults to `en` when neither signal fires.
- **Roll table auto-detection** (`mpx.autoDetectRollTables`): mirrors `Module.yaml`'s own `create-roll-tables: true`/`false` when it's a real boolean; defaults to `true` (matching [Compendium](Compendium)'s own default) when the field is absent.
- Six `Module.yaml` options have no MPX equivalent and are only *noticed*, not acted on: `auto-increment-version`, `compress-images`, `delete-empty-groups`, `print-cover`, `print-document-size`, `print-link-update`. A page's own `cover`, `footer`, `hide-footer`, `hide-footer-text`, `pdf-page-style`, `pdf-pagebreaks`, `print-cover-only` front-matter fields are noticed the same way, per page.
- A missing `Module.yaml` doesn't fail the conversion — it produces a `missing-module-manifest` notice and the module falls back to folder-name-derived metadata.

## Pages

- **Slugs**: an explicit MP `slug` is kept (through MPX's own `slugify()`, since MP's own slug rule is looser); otherwise one is derived from the page name. A duplicate explicit slug is noticed and kept as-is (still duplicated); an auto-derived collision gets a `-1`/`-2`/... suffix.
- **Parent resolution**: `parent` (or `parent-page`) is checked against every real page/group slug after the whole project is scanned; an unresolvable one is dropped with an `unknown-parent` notice rather than failing.
- **`module-pagebreaks: h1, h2, ...`**: splits one MP page into several MPX pages, one per matching heading, nested by heading level (an `h2` under the preceding `h1` becomes its child, etc.) — reproducing MP's own page-per-heading split. Content before the *first* splitting heading is dropped, matching MP's own export behavior (`Module.ts`'s `prevAll`/`.before-next-page-header` handling): only a block explicitly marked `{.before-next-page-header}` is kept, moved to the top of the very first split page (typically a cover image) — anything else there is reported with a `dropped-pagebreak-preamble` notice rather than silently lost.
- A page (or MP subfolder) with `include-in: print` or `include-in: compendium` is excluded entirely (counted in `excludedPageCount`), matching MP's own semantics for those values.
- A `(print-column)`/`(print-page)` marker in the content is noticed (`print-marker`) but left in place — PDF-only in MP, meaningless in MPX, but not worth stripping automatically.

## Groups

Only an MP subfolder that declares its **own** `Group.yaml` becomes an MPX group — a plain subfolder used purely for filesystem organization (no `Group.yaml`) is *not* turned into a phantom group; its own Markdown files/subfolders are still scanned and attached to whichever real group the nearest ancestor resolved to. A `Group.yaml` with `include-in: files` (or a sibling `.ignoregroup` file) is skipped entirely, matching MP's own convention for a folder that only holds raw files (e.g. map/encounter `.zip`s — see below) rather than real content.

## Blockquote decorations

Two legacy `markdown-it-decorate` authoring styles are rewritten to MPX's `{.class}` syntax (`markdown-it-attrs`), since the original extension was dropped and neither survives untouched:

- The comment form: `<!--{blockquote:.red.color-links}-->` → `{.red .color-links}` on its own line.
- The glued form: `{.class}` appended directly onto a blockquote's own last line (`...text.{.read}`) → split onto its own line below the block. `markdown-it-attrs` only recognizes the attribute on a dedicated line right after the block; glued to the text it's silently ignored, which is why this rewrite exists.

A `legacy-decoration` notice is produced per page that used either form (informational — the rewrite already happened).

## Inline compendium blocks (Item/Spell/Monster)

A fenced ` ```Item `/` ```Spell `/` ```Monster ` block (MP's own inline authoring, optionally carrying a fence attribute like `{.two-column}`, preserved verbatim) is reshaped from MP's flat, mostly-English-prose field vocabulary into MPX's own (nested `data:`, enum-checked values, structured sub-objects) — see [Compendium](Compendium) for what that target vocabulary is. A block's image/token is copied into `images/` under its own base file name, with `addImageToCompendium`/`addTokenToCompendium: true` set so it's also copied into `items/`/`spells/`/`monsters/` at build time and shows in EncounterPlus's own Compendium detail view too — see [Where the illustration image lives](Compendium#where-the-illustration-image-lives) for why an inline block's image lives in `images/`, unlike a standalone file's own (a name collision between two different source files sharing `images/` is noticed as `duplicate-compendium-image`, keeping the first one copied; a referenced file that can't be found is `missing-compendium-image`). MP's own `show-image: false` (hiding the image from the card while still keeping it in MP's own reference) has no MPX equivalent — an authored image always shows on the card now — so this is folded into a field notice instead of silently changing behavior.

**Never silently dropped**: a value with no direct MPX field — an enum MPX doesn't recognize, or a concept MPX has no field for at all (e.g. a monster's `mythic-actions`, which MPX's schema doesn't support) — is appended to the entry's own `descr` under a clearly labeled "_Converted from MP — not carried over automatically:_" section, rather than lost. A field-level compromise (an unrecognized enum value, an unparseable free-text field, a currency conversion, etc.) is also reported as a `compendium-field-notice`, one per field per block. A summary `compendium-blocks-converted` notice gives the total item/spell/monster counts once the whole project is done.

Notable field-level reshaping, by kind:

- **Item**: `type` matched against the real item type list, falling back to `type: "custom"` + `typeDetail: <original text>` when unrecognized. `attunement` free text → `attunement: true` + `attunementDetail: <text>`. `primaryDamage`/`secondaryDamage` → `dmg1`/`dmg2`. `properties` (comma string or array) matched per-entry. `damageType` → `dmgType`. `value` ("1 gp", "50 sp", ...) → a plain gp number, converted at standard D&D rates (cp = 0.01, sp = 0.1, ep = 0.5, gp = 1, pp = 10). `source` (a single string in MP) → `sources: [{ name: <value> }]`.
- **Spell**: `time` free text ("1 action", "1 bonus action, ...", "1 hour", ...) parsed into `activation.time`/`activation.unit` (+ a bonus-action `condition` clause when present). `duration` free text ("Instantaneous", "Until dispelled", "Concentration, up to 1 minute", "3 rounds", ...) parsed into `durationType`/`duration`/`durationUnit`. `range` free text — a plain number, or a composite like "Self (30-foot radius)" — parsed into `rangeType`/`areaEffectShape`/`areaEffectSize` (radius defaults to a sphere; cone/cube/line/square/cylinder recognized by keyword). `components`/`classes` (comma string or array) kept as arrays.
- **Monster**: `size`/`alignment` word forms ("Medium", "neutral evil", ...) matched to their letter/code forms. `ac`/`hp` coerced to strings (schema requirement). `speed`/`senses` free text parsed into their structured `{walk, burrow, climb, fly, swim, hover, other}`/`{blindsight, darkvision, tremorsense, truesight, other}` shapes, with `senses`' own "passive Perception N" pulled out into the separate `passivePerception` field. `saves`/`skills` free text ("Str + 2", "Stealth +6", ...) parsed into `savingThrows`/`skills` keyed by ability/skill name. `vulnerabilities`/`resistances` → `damageVulnerabilities`/`damageResistances` (renamed, matched per-entry); `damageImmunities`/`conditionImmunities` keep their name, comma string → array. `challenge` → `cr`. `traits`/`actions`/`bonus-actions`/`reactions`/`legendary-actions` → camelCase (`bonusActions`, `legendaryActions`); each entry's `description` → `text`. `mythic-actions` has no MPX field at all — folded into `descr` (see "Never silently dropped" above) rather than dropped. An explicit `id` is kept if it's a valid UUID.

## Maps and encounters

`Module.yaml`'s `maps:`/`encounters:` entries (`path`/`order`/`parent`/`slug`) are each converted into a `maps/<slug>.json`+`.zip` (or `encounters/`) pair — MPX's own reference-file-plus-real-export-archive shape (see [Build Module](Build-Module#maps-and-encounters-the-real-export-format)). Since `Module.yaml` itself never carries a display name for one of these, a readable fallback is derived from the `.zip`'s own file name (`my-first-map.zip` → "My First Map") — overridden by the archive's real `name` when it can be read (see below). An unresolvable `parent` slug is dropped with an `unknown-parent` notice, same as a page's.

The referenced `.zip` is inspected, not just copied blindly:

- **Already in EncounterPlus's current export format** (contains a real `maps.json`/`encounters.json` manifest, e.g. re-exported since the MP project was authored): copied through, with its real `name`/`descr` read from the manifest instead of guessed from the file name.
- **Still in the older MP-era export format, or anything else unreadable as a real export**: copied through as-is regardless (MPX's own build is what will eventually complain if it can't read it), with the file-name-derived name/no description, and the summary notice below calls out how many need a fresh V5 export.
- **Missing entirely on disk**: MP itself never reads this file either (only copies it through), so its absence alone isn't fatal — a `missing-archive` notice is produced *unless* a root-level `maps.json`/`encounters.json` (see below) has an entry for the same slug, in which case the archive is rebuilt from that instead.

**Rebuilding from a leftover root manifest**: MP itself writes a `maps.json`/`encounters.json` next to `Module.yaml` as a residual build artifact (see the original tool's `exportXML`) — a project folder that's been built at least once often still has one lying around, even after the actual `.zip` files were removed (e.g. a community module shared without its raw exports). When a referenced `.zip` can't be found, the same slug is looked up in that leftover manifest; if present, a real export archive is reconstructed from it: the manifest entry itself, plus every resource file it references (`image`, `floor`, `token`, `resource`, `canvas`, `fog`, `snapshot` — the manifest's own real resource-bearing keys, not any string that merely looks like a file name) that's still sitting at the project root. A resource is only renamed (slug-prefixed) when it actually collides with one an earlier reconstructed archive already claimed — most shared assets never do, so most keep their original name.

A summary `archives-converted` notice gives the total count, how many were rebuilt from a leftover manifest, and how many are still in the older export format.

## Not included (yet)

- **No `.module`/`.mpmodule` conversion** — only an MP *project folder* (`Module.yaml` + Markdown) is a supported source. A module already built by MP packs everything into a single archive (`module.xml`, a merged `compendium.xml`, per-type `monsters.json`/`items.json`/`spells.json`, `maps.json`/`encounters.json`) in a shape this conversion doesn't read directly — though it happens to be close to MPX's own compendium field vocabulary already (see [Compendium](Compendium)), a real `.module` → MPX project conversion is a separate, not-yet-built pipeline.
- **No legacy visual rendering** — a converted item/spell/monster block renders through MPX's *current* Compendium block markup/CSS (see [Compendium](Compendium)), not a visual reproduction of MP's own dnd5e-ruleset rendering. The underlying data is preserved faithfully (see "Never silently dropped" above); the on-page appearance is not.
- **PDF/print-only options** — noticed, never acted on (see [Module-level detection](#module-level-detection) and [Pages](#pages) above).
