# Markdown Preview Engine

Makes VSCode's built-in Markdown preview (open a `pages/*.md` file, "Open Preview") look like the actual EncounterPlus rendering, using the project's own theme.

## How it works

Two independent layers:

1. **Static, extension-wide**: a small CSS file and a small JS file, injected into *every* Markdown preview VSCode opens (not just MPX projects):
   - Adds the `catalyst` class to `<html>` — the CSS class root EncounterPlus's own HTML-based rendering engine ("Catalyst") uses; theme CSS won't apply without it.
   - Scales the preview to 80% to roughly match the app's real proportions.
   - Works around VSCode forcing its own editor-theme color onto `<hr>` borders, so the project's theme color shows instead.
   - Neutralizes VSCode's default preview padding so the theme controls page spacing itself.

2. **Dynamic, per-project**: when a folder with a `module.json` is open, VSCode's `markdown.styles` workspace-folder setting is pointed at that project's own `assets/css/global.css` and `assets/css/custom.css` — the exact same files the build bundles into the `.module`, so the preview and the real output stay visually in sync. Any style entry you added yourself is left alone.

## Rendering differences from a build

The same core Markdown renderer is used for both the preview and `Build Module`, with a `preview` mode adding:
- Front matter (`---...---`) is hidden — never rendered.
- `#page` wraps the rendered content (matching how EncounterPlus roots a page's styling), except for inline-only fragments.
- `images/...` and `/images/...` paths are adjusted with a `../` prefix, since a page file lives in `pages/` but images live in `images/` at the project root — the build's HTML doesn't need this adjustment, since there's no such nesting in the final module.

Two more rules apply in both modes — the real app needs them just as much as the preview does:

- **Blockquote wrapping**: `> text {.paper}` → `<div class="blockquote-paper-wrap"><blockquote class="paper">...`. `.paper` and `.flavortext` get their own wrapper div; plain/`.read`/colors share a generic one. `.flowchart`/`.flowchart-with-link` get **no wrapper at all** — that variant's spacing and connecting line live directly on the `<blockquote>` itself in the current theme's CSS, and a wrapper div clips its border image and misaligns the line between two consecutive flowchart quotes.
- **Image captions**: `![Alt text](images/x.png){.caption}` renders as `<figure><img ...><figcaption>Alt text</figcaption></figure>` instead of a bare `<img>`. `.caption` is a marker, not a real CSS class — it's removed from the rendered `<img>`'s class list. Other classes (e.g. `{.caption .center}`) are kept.
- **A leading `/images/...` path is normalized** to `images/...` in the built module — EncounterPlus fails to load the former, confirmed by a real import test.
- **Image size syntax**: `![alt](images/x.png =300x200)` sets `width`/`height` on the `<img>`. Either dimension can be omitted (`=150x` for width-only, `=x200` for height-only) — at least one is required, and each must be a positive integer, or the syntax is ignored and the image renders as plain Markdown text. Combines with `{.caption}` and other classes normally.

## Known limitations

- **Reopen the preview after switching a project's theme** (once theme switching exists again, see [issue #6](https://github.com/BriocheMasquee/mpx-bis/issues/6)) — VSCode has no reliable API to force-reload an already-open preview.
- **Replaces VSCode's Markdown renderer rather than extending it** — matches how both the original Module Packer and the old MPX always did it, but means other installed Markdown extensions' rendering additions don't apply while previewing an MPX page. Tracked as a possible future improvement in [issue #13](https://github.com/BriocheMasquee/mpx-bis/issues/13), not solved upfront.
- **No `.ttc`/`.otc` font collection support** — VSCode's preview can't load font collection files directly (the current theme only uses `.woff2`, so this doesn't affect it today); revisit if a future theme needs it.
