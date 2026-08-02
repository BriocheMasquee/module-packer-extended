# Build Module

Compiles the current module project into a single `.module` file, ready to import into EncounterPlus V5.

## How to use it

Run `MPX: Build Module` (palette or the panel's title bar button). Open files are saved automatically first. If more than one workspace folder is open, you're asked which one to build.

## What happens

- `module.json` is read and validated. If it has no `id`, one is generated and written back so it stays stable across builds.
- Every page, group, map, and encounter is read and validated.
- **All issues are collected before failing** — if several files have problems, you get the full list at once (in the "MPX" output channel), not one at a time.
- IDs are resolved: for pages/groups, an explicit `id` is kept if it's a valid UUID, otherwise one is derived deterministically from the slug (same slug → same id across builds). For maps/encounters, the id is **always** recomputed from the slug — any `id` present in the reference file or the export archive is ignored.
- Parents are resolved **strictly**: an unknown parent slug, a duplicate slug (across any of the 4 types), a parent cycle, or using a map/encounter as a parent all fail the build with a clear error. This is stricter than the Module Explorer view, which stays lenient (invalid parents just show at the root) so editing doesn't feel broken while you're mid-change.
- Page Markdown is rendered to HTML (tables, sub/sup, mark, underline, and heading anchors are supported, matching the original MPX).
- `images/` and `assets/` are copied into the archive.
- `module.json`'s `image`/`banner` files (declared at the project root) are bundled at the archive root.
- The archive is written uncompressed (stored), which is what EncounterPlus expects — a compressed archive fails to import.

## Maps and encounters: the real export format

A map or encounter reference file (`maps/<slug>.json` / `encounters/<slug>.json`) doesn't hold the map/encounter data itself — its `path` field must point to a real **EncounterPlus export archive** (a zip), which contains:

- A manifest at the archive root — `maps.json` for maps, `encounters.json` for encounters — holding a JSON array with **exactly one object** (the actual map/encounter data: grid, tokens, etc. for maps; combatants, etc. for encounters).
- Any number of resource files (images, etc.), at any path inside the archive.

At build time, MPX reads that archive, merges its resources **flat at the root of the `.module`** (EncounterPlus never sees the original export zip — MPX unpacks it), and produces the final record by combining the export's data with the local reference file's `name`/`slug`/`rank`/`descr` (the local file wins when both are set).

- For maps only, if the export's `image` or `floor` field is set, the resource it names must actually be present in the archive — image/floor are not required fields themselves, only checked when set.
- If two different exports (map or encounter) contain a resource with the same internal name, or a resource's name collides with a reserved module file/folder (`images/`, `assets/`, `*.json` manifests, etc.), the build fails rather than silently overwriting one with the other.
- `path` is protected against path traversal (it can't resolve outside the project folder) — the same protection applies to `module.json`'s `image`/`banner`.

## Not included (yet)

- No items/spells/roll tables/monsters — Compendium content isn't implemented yet, so the build only produces pages/groups/maps/encounters.
- No inline content blocks in Markdown pages (items/spells/monsters/tables defined directly inside a page) — depends on Compendium support.
