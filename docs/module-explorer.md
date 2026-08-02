# Module Explorer

Displays the structure of the currently open module (pages, groups, maps, encounters) in the MPX sidebar panel, without needing to browse the project's files manually.

## How to use it

Open the MPX panel (activity bar icon). The "Module" view lists the module's content as a tree:

- Pages, groups, maps, and encounters are nested according to each item's `parent` field (matched by `slug`).
- Within the same level, items are ordered by `rank`, then alphabetically by name.
- Each item shows its `rank` in a muted color next to its name.
- Clicking an item opens its file.
- The tree refreshes automatically when a relevant file is created, changed, or deleted. A manual "Refresh" button is also available in the view's title bar.

## Content sources

- Pages: `pages/**/*.md`, metadata read from the Markdown front matter (`name`, `slug`, `rank`, `parent`).
- Groups: `groups/**/*.json` (`name`, `slug`, `rank`, `parent`).
- Maps: `maps/**/*.json` (`name`, `slug`, `rank`, `parent` — falls back to the slug, then the file name, if `name` is missing).
- Encounters: `encounters/**/*.json` (same shape as maps).

If a `parent` value doesn't match exactly one other item's `slug` (missing, or matching more than one), or if following the parent chain would create a cycle, the item is placed at the root instead of being nested — the tree never breaks or hides content because of bad data.

## Not included (yet)

- Items, spells, and roll tables don't appear here — they're flat compendium content with no `parent`/`rank`, shown instead in the separate [Compendium](Compendium) view.
- No right-click context menu on tree items (create/rename/delete from a node) — matches the current command set, which only has "Create Module Project" so far.
