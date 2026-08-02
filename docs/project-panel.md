# Project Panel Section

A "Project" section in the MPX sidebar, above "Module", for everything about the project as a whole rather than its content (pages/groups/maps/encounters, covered by the [Module Explorer](Module-Explorer)).

## What it shows

- A **summary** line (module name, version, system) — clicking it opens `module.json`.
- **Project Settings**, if `.vscode/settings.json` exists — opens it directly. This is where `mpx.autoIncrementVersion` lives (see [Build Module](Build-Module)).
- **Cover Image** / **Banner** entries, if `module.json`'s `image`/`banner` fields are set and the file exists — labeled by role, with the actual file name shown next to it. Clicking opens the image.
- **`images/`** and **`assets/`** as expandable folders, browsable in place (files clickable to open) — no need to switch to VSCode's Explorer tab just to look inside them.

Before a project exists (empty folder, no folder open, or an unrecognized folder), this section shows the welcome message and the "Create Module Project" button — creation is a project-level action, not a module-content one.

## Where "Build Module" lives

The "Build Module" button is in this section's title bar, not "Module" — building produces the whole module, it's not a content-creation action.

## Not included (yet)

- No image thumbnail/preview for the cover — VSCode's tree view only supports small icon-sized images, which didn't look good here, so Cover Image/Banner use a plain icon; click still opens the actual image full-size in an editor tab. A real centered preview would need a custom webview, not implemented.
- Theme selector and Compendium summary — tracked in [issue #4](https://github.com/BriocheMasquee/mpx-bis/issues/4), waiting on their underlying features.
