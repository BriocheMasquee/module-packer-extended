# Snippets

Editor snippets for Markdown pages, contributed via `extension/resources/snippets/markdown.json`. Type a prefix and accept the suggestion (press `Ctrl+Space`/`⌃Space` first if it doesn't pop up on its own) to insert it. Every snippet has tab stops (`Tab`/`Shift+Tab` to move between them) and, where relevant, a dropdown to pick a class from a list rather than typing it by hand.

These aren't tied to the project's theme (`mpx.projectTheme`) — the extension contributes them globally, the same set in every project regardless of which theme is selected. A formatting snippet's class names (`.paper`, `.blue`, ...) are only guaranteed to render as intended under the current `5.5e` theme; see [Create Module Project](Create-Module-Project#theme-selection) for how a project's theme is chosen.

## Compendium content

- **`mpx-spell`** — a complete inline ` ```spell ` block, every YAML field with sensible empty defaults. See [Compendium](Compendium#inline-spell-authoring).
- **`mpx-item`** — a complete inline ` ```item ` block. See [Compendium](Compendium#inline-item-authoring).
- **`mpx-monster`** — a complete inline ` ```monster ` block. See [Compendium](Compendium#inline-monster-authoring).

## Blockquote variants

- **`mpx-read`** — a read-aloud text box:
  ```
  > Text to read aloud.
  {.read}
  ```
- **`mpx-paper`** — a parchment-style note:
  ```
  > Text on parchment.
  {.paper}
  ```
- **`mpx-flavortext`** — flavor text:
  ```
  > Flavor text.
  {.flavortext}
  ```
- **`mpx-large-quote`** — a large centered pull-quote:
  ```
  > Quotation text.
  {.large-quote}
  ```
- **`mpx-blockquote`** — a plain blockquote, no class:
  ```
  > Quotation text.
  ```

## Layout and formatting

- **`mpx-flowchart`** — a flowchart step, a dropdown picks `.flowchart` or `.flowchart-with-link`:
  ```
  > **Title** {.text-center}
  >
  > Flowchart text. {.flowchart}
  ```
- **`mpx-image`** — an image, a dropdown picks `.size-cover`, `.float-left`, `.float-right`, `.center`, `.caption`, or none:
  ```
  ![Description](images/image.png){.caption}
  ```
- **`mpx-text`** — a paragraph with alignment, a dropdown picks `.text-center`, `.text-right`, or `.text-left`:
  ```
  Text. {.text-center}
  ```
- **`mpx-table`** — a 2-column/1-row example table, a dropdown picks a color (`.blue`, `.green`, `.red`, `.orange`, `.yellow`, `.gray`, `.purple`, `.teal`, `.magenta`, `.signature`) or a layout class (`.center`, `.float-left`, `.float-right`), or none:
  ```
  | Column 1 | Column 2 |
  | --- | --- |
  | Value 1 | Value 2 |
  {.blue}
  ```
- **`mpx-roll-table`** — a table auto-detected as a roll table at build time, see [Compendium](Compendium#roll-table-auto-detection):
  ```
  Roll Table Title {.table-title}

  |[2d6](/roll/2d6)|Result|
  |:---:|:---|
  |2|Result A|
  |3-4|Result B|
  ```

## Not included (yet)

- No `.shop` table snippet — its markup needs a `{.shopH1}`/`{.shopH2}` class on individual rows, not just the table as a whole, a different (more involved) shape than every other table variant here. Left out of this first pass.
