# Project Panel Section

A "Project" section in the MPX sidebar, above "Module", for everything about the project as a whole rather than its content (pages/groups/maps/encounters, covered by the [Module Explorer](Module-Explorer)).

## What it shows

In this order:

- A **summary** line (module name, version, system) — clicking it opens `module.json`.
- A **Theme** line, showing the current theme's name (e.g. "5.5e") — clicking it runs `MPX: Select Project Theme` (see [Create Module Project](Create-Module-Project#theme-selection)). Re-selecting the current theme resyncs `assets/` from the extension's bundled copy.
- **Cover Image** / **Banner** entries, if `module.json`'s `image`/`banner` fields are set and the file exists — labeled by role, with the actual file name shown next to it. Clicking opens the image.
- **Project Settings**, if `.vscode/settings.json` exists — opens it directly. This is where `mpx.autoIncrementVersion` lives (see [Build Module](Build-Module)).
- A **Translation Overrides** line — if `translation-overrides.json` exists at the project root, shows the number of overrides it defines (e.g. "2 overrides") and opens it. Otherwise shows "Create…" and runs the same command as **MPX: Create Translation Overrides File** — see [Localization](Localization).
- A **Compendium :** line — the total entry count (e.g. "15 entries"). Clicking it switches focus to the [Compendium](Compendium) panel, where each category's label shows its own count in parentheses (e.g. "Monsters (3)").
- **`images/`** and **`assets/`** as expandable folders, browsable in place (files clickable to open) — no need to switch to VSCode's Explorer tab just to look inside them.

A "Collapse All" button (VSCode's built-in tree action) sits at the end of the title bar, alongside the [Compendium](Compendium) and [Module](Module-Explorer) panels' own.

Before a project exists (empty folder, no folder open, or an unrecognized folder), this section shows the welcome message and the "Create Module Project" button — creation is a project-level action, not a module-content one.

## Title bar buttons

Three icon buttons sit in this section's title bar, not "Module" — none of them are module-content actions:

- **Build Module** — builds the whole module.
- **Select Project Theme** — same command as clicking the Theme line.
- **Create Translation Overrides File** — same command as the Translation Overrides line's "Create…" state; still useful once `translation-overrides.json` already exists too, since the command opens it either way — a quicker path than scrolling to find the tree line.

## Not included (yet)

- No image thumbnail/preview for the cover — VSCode's tree view only supports small icon-sized images, which didn't look good here, so Cover Image/Banner use a plain icon; click still opens the actual image full-size in an editor tab. A real centered preview would need a custom webview, not implemented.
