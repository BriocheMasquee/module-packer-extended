# Create Module Project

Initializes a new, empty EncounterPlus V5 module project, ready to be edited.

## How to use it

Three equivalent entry points:

1. **Sidebar welcome view**: open the MPX panel (activity bar icon) before opening any folder, or after opening an empty folder. Click "Create Module Project".
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
- `assets/`: populated with the default MPX theme (`css/`, `font/`, `img/`, `js/`).

After creation, VSCode opens the project's folder as the workspace and opens `module.json` in the editor so you can fill in the metadata.

## Not included (yet)

- No theme picker — the default theme is applied automatically. Theme selection will come back as a later feature.
- No conversion from legacy Module Packer / EncounterPlus V4 projects — out of scope for now, see the project's overall creation-first scope.
