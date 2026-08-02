# Create Page / Group / Map Reference / Encounter Reference

Four commands to add content to an existing module project: `MPX: Create Page`, `MPX: Create Group`, `MPX: Create Map Reference`, `MPX: Create Encounter Reference`. Also available as buttons in the MPX panel's title bar.

## How to use it

1. Run the command (palette or panel button). If more than one workspace folder is open, you're asked which one to add the content to.
2. Enter a name (a default like "New page" is pre-filled).
3. The file is created, opens automatically, and the Module Explorer refreshes.

If the generated slug already matches an existing file, the command fails with a clear error — nothing is overwritten.

## What gets created

- **Page** (`pages/<slug>.md`): Markdown front matter with `name`, `slug`, `rank: 0`, and an empty `parent`.
- **Group** (`groups/<slug>.json`): `{ name, slug, rank: 0, parent: "" }`.
- **Map Reference** (`maps/<slug>.json`): same as Group, plus `path: "maps/"` and `descr: ""`.
- **Encounter Reference** (`encounters/<slug>.json`): same as Map Reference, with `path: "encounters/"`.

`slug` is generated automatically from the name.

While editing any of these files, VSCode validates them against their EncounterPlus schema (autocomplete, hover docs, red squiggles on missing/invalid fields) — including a stricter authoring hint for map/encounter `path` (must look like `maps/file-name.zip` / `encounters/file-name.zip`) than what a build actually requires.

## Not included (yet)

- No parent picker at creation time — `parent` is always written empty; set it by hand in the file. The Module Explorer will pick up the nesting once you do.
- No automatic rank calculation — `rank` is always `0`; reorder siblings by hand if needed.
- No authoring assistance for Markdown page front matter (no native VSCode schema support for that) — tracked separately in [issue #1](https://github.com/BriocheMasquee/mpx-bis/issues/1).
