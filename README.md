<div align="center">
  <img src="branding/mpx-icon-256.png" alt="MPX logo" width="160">

  # Module Packer Extended for EncounterPlus V5 (community fork)

  A VSCode extension for building [EncounterPlus](https://itunes.apple.com/us/app/encounter+/id1170693487?ls=1&mt=8) V5 modules from Markdown and JSON sources.

  ![License: CC0-1.0](https://img.shields.io/badge/license-CC0--1.0-blue)
  ![Status: beta](https://img.shields.io/badge/status-beta-orange)
</div>

> [!WARNING]
> **MPX is currently in beta.** Keep an independent backup of your source project and of your EncounterPlus data — test built modules on a copy first. Between beta versions, project files and settings are **not guaranteed to stay backward compatible**; check the changelog before upgrading an existing project.

<div align="center">

📖 **[Documentation (Wiki)](../../wiki)**

</div>

## Table of contents

- [Origin](#origin)
- [What MPX is](#what-mpx-is)
- [Documentation and current state](#documentation-and-current-state)
- [License and credits](#license-and-credits)

## Origin

MPX is a personal project that I am making available to the community. It is neither official nor affiliated with EncounterPlus, and it is not intended to replace the original project.

MPX is a community fork of [EncounterPlus Module Packer](https://github.com/encounterplus/module-packer), distributed under the [CC0 1.0 Universal license](https://github.com/encounterplus/module-packer/blob/master/LICENSE); its latest release (`1.0.63`) and latest commit were published on March 3, 2024.

It started from personal needs the original project didn't cover: French/English localization, compatibility with EncounterPlus's redesigned **V5** module format, and a more workable way to manage theme CSS across projects. MPX reworks the original's approach to address those, built as a VSCode extension.

## What MPX is

MPX is a tool for **module content authors**, complementary to [EncounterPlus](https://itunes.apple.com/us/app/encounter+/id1170693487?ls=1&mt=8) itself (which runs the module at the table) and to a rules-reference tool like EncounterLog — it's what you use beforehand, to write and package the content.

## Documentation and current state

Full documentation — every feature, field, and setting — lives on the **[Wiki](../../wiki)** (English; a French version may follow).

Tested against real EncounterPlus imports. What MPX adds on top of the original Module Packer:

- A Compendium: items, spells, roll tables, and monsters — as standalone files or authored inline in a page.
- A Markdown preview updated to match the current D&D 5.5e visual style, mirroring the real EncounterPlus rendering (theme CSS, compendium cards, stat blocks).
- English and French content, with unit conversion (imperial/metric) and per-project label overrides.
- A selectable project theme (CSS).
- Improved snippets and YAML autocompletion.
- Improved roll table auto-detection.
- Advanced Markdown rendering customization options, via project settings.

Not supported (yet):

- Conversion from legacy Module Packer / EncounterPlus V4 projects — this is a creation-first rebuild.
- PDF export (available in the original Module Packer).
- Opening an already-built `.module` file for editing.

## License and credits

[CC0-1.0](LICENSE.md) for this project's own code and content; bundled theme fonts and the localization catalogs are third-party work under their own terms — see [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).

Module Packer is the original work of its creator and contributors. EncounterPlus, its name, and its visual resources remain the property of their respective owners.
