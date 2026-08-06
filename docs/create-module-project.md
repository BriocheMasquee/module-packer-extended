# Create Module Project

Initializes a new, empty EncounterPlus V5 module project, ready to be edited.

## How to use it

Three equivalent entry points:

1. **Sidebar welcome view**: open the MPX panel (activity bar icon) before opening any folder, or after opening an empty folder — the [Project section](Project-Panel) shows a "Create Module Project" button. Click it.
2. **Command palette**: run `MPX: Create Module Project`.
3. Same command either way — if no folder is open, you'll be asked to pick an empty folder first; if more than one workspace folder is open, you'll be asked which one to use.

The target folder must be empty. If it already contains files (including an existing `module.json`), the command refuses and shows an error — nothing is overwritten.

## What gets created

- `module.json` at the project root, with every field the EncounterPlus V5 schema defines — required ones pre-filled, the rest present but empty so you know they exist:
  - `id`: a randomly generated UUID (v4).
  - `name`: derived from the folder name.
  - `slug`: a URL-safe version of the name.
  - `version`: `1.0.0`.
  - `system`: `dnd5e`.
  - `acronym`, `category`, `author`, `shortDescr`, `descr`, `tags` (`[]`), `image`, `banner`, `website`, `repository`, `package`: empty, to be filled in as needed.
- `images/`: empty folder for the project's images.
- `assets/`: populated with the selected theme's assets (`css/`, `font/`, `img/`, `js/`) — see [Theme selection](#theme-selection) below.
- `.vscode/settings.json`: `{ "mpx.projectTheme": "5.5e", "mpx.autoIncrementVersion": true, "mpx.contentLanguage": "en", "mpx.defaultMeasurement": "auto" }` — see [Theme selection](#theme-selection) below, [Build Module](Build-Module) for `autoIncrementVersion`, and [Compendium](Compendium) for the other two.

After creation, VSCode opens the project's folder as the workspace and opens `module.json` in the editor so you can fill in the metadata. While editing `module.json`, VSCode validates it against the EncounterPlus schema — missing required fields and invalid values are underlined, and field descriptions show on hover.

## Theme selection

A theme picker prompts for which one to use — but only when there's an actual choice: today the extension bundles a single real theme (`5.5e`), so creation applies it automatically without asking. The picker starts showing on its own the moment a second theme exists, no code change needed at the call site.

The choice is recorded in `mpx.projectTheme` (`.vscode/settings.json`) and can be changed afterward — see the [Project panel](Project-Panel)'s Theme entry, or run `MPX: Select Project Theme`. Re-selecting the *current* theme still does something useful: it resyncs `assets/` from the extension's own bundled copy, which is how a project picks up a theme fix or improvement shipped in a later extension update (a project's `assets/` is copied once at creation time, never automatically kept in sync otherwise). `assets/css/custom.css` and `assets/js/custom.js` are never touched by a resync once they exist — that's the project's own customization layer, only ever seeded from the theme's template the first time.

See [Themes](Themes) for what each bundled theme actually looks like, and its fonts' licensing.

## Not included (yet)

- Only one real theme ships today (`5.5e`) — porting old MPX's "legacy" theme (the classic Module Packer appearance) needs real CSS compatibility work first, since its markup conventions predate the Compendium block system (`.compendium-block`, `.statblock-*`, `.table-title`) entirely.

## See also

- [Convert MP Project](Convert-MP-Project) — the other way to get a new MPX project, starting from an existing Module Packer V4 project folder instead of an empty one.
