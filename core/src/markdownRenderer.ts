import MarkdownIt from 'markdown-it'
import type { MarkdownIt as MarkdownItInstance, Token, StateBlock, StateInline } from 'markdown-it'
import { parseSpellBlock, renderSpellBlockHtml } from './spellBlock.js'
import type { SpellDisplayDefaults } from './spellBlock.js'
import { parseItemBlock, renderItemBlockHtml } from './itemBlock.js'
import type { ItemDisplayDefaults } from './itemBlock.js'
import { parseMonsterBlock, renderMonsterBlockHtml } from './monsterBlock.js'
import type { MonsterDisplayDefaults } from './monsterBlock.js'
import { escapeHtml } from './compendiumBlock.js'
import { slugify } from './slug.js'
import type { MeasurementSystem, ContentLanguage } from './localization.js'
import type { CatalogOverrides } from './catalog.js'
import type { ValidationIssue } from './compendiumShared.js'

// These plugins have no usable published types, so they're loaded via require()
// (typed `any` by @types/node) rather than `import`, matching how the rest of
// the ecosystem consumes them.
const anchor = require('markdown-it-anchor')
const attrs = require('markdown-it-attrs')
const mark = require('markdown-it-mark')
const multimdTable = require('markdown-it-multimd-table')
const sub = require('markdown-it-sub')
const sup = require('markdown-it-sup')
const underline = require('markdown-it-underline')

export interface MarkdownRendererOptions {
  /** Enables preview-only behavior: hides YAML front matter, adjusts image
   * paths for the pages/ -> images/ layout, and wraps output in #page —
   * matching what the built .module's HTML looks like once EncounterPlus
   * loads it from the module root instead of a page file. */
  preview?: boolean
  /** Resolved target unit system for generated labels (e.g. a spell's
   * range/duration). Defaults to "imperial" when not provided.
   *
   * Accepts a getter instead of a fixed value so preview rendering can read
   * the workspace setting fresh on every render call — VSCode builds the
   * markdown-it instance once per session (see extension.ts), so a fixed
   * value here would freeze the resolved system for the rest of the session
   * even after the user changes mpx.defaultMeasurement/mpx.contentLanguage. */
  measurement?: MeasurementSystem | (() => MeasurementSystem)
  /** Resolved target content language for generated labels (school names,
   * skill names, etc.) — free-text fields (descr, name, ...) are never
   * translated. Defaults to "en". Same getter-vs-value flexibility as
   * `measurement`, for the same live-preview-refresh reason. */
  language?: ContentLanguage | (() => ContentLanguage)
  /** The project's `translation-overrides.json`, if any — merged on top of
   * the resolved language's catalog before every lookup, renaming a catalog
   * key's displayed word project-wide. Same getter-vs-value flexibility as
   * `measurement`. */
  overrides?: CatalogOverrides | (() => CatalogOverrides)
  /** Project-level fallback for a spell's `show*` toggles when its own YAML
   * leaves one absent. Same getter-vs-value flexibility as `measurement`,
   * for the same live-preview-refresh reason. */
  spellDisplayDefaults?: SpellDisplayDefaults | (() => SpellDisplayDefaults)
  /** Same as `spellDisplayDefaults`, for an item's `show*` toggles. */
  itemDisplayDefaults?: ItemDisplayDefaults | (() => ItemDisplayDefaults)
  /** Same as `spellDisplayDefaults`, for a monster's `show*` toggles. */
  monsterDisplayDefaults?: MonsterDisplayDefaults | (() => MonsterDisplayDefaults)
}

/** Collected while rendering a page, so the build can merge inline
 * Compendium blocks into the same output as standalone files. Not read
 * during preview rendering. */
export interface MpxMarkdownEnvironment {
  [key: string | symbol]: unknown
  inlineSpells?: InlineSpellBlock[]
  inlineItems?: InlineItemBlock[]
  inlineMonsters?: InlineMonsterBlock[]
  inlineRollTables?: InlineRollTableBlock[]
  /** The current page's front-matter name/slug, used only to build a roll
   * table's default name/slug when no {.table-title} heading precedes it.
   * Set by callers that already parse front matter (buildModule's
   * readPages, findInlineRollTables) before calling render; when unset (the
   * real VSCode preview, which drives render() itself) installRollTableDetection
   * falls back to reading the raw front-matter block off state.src. */
  pageName?: string
  pageSlug?: string
}

export interface InlineSpellBlock {
  data: Record<string, unknown>
  issues: ValidationIssue[]
  /** 0-based source line the fence starts at, for "reveal in page" navigation. */
  line: number
}

export interface InlineItemBlock {
  data: Record<string, unknown>
  issues: ValidationIssue[]
  /** 0-based source line the fence starts at, for "reveal in page" navigation. */
  line: number
}

export interface InlineMonsterBlock {
  data: Record<string, unknown>
  issues: ValidationIssue[]
  /** 0-based source line the fence starts at, for "reveal in page" navigation. */
  line: number
}

export interface InlineRollTableBlock {
  data: Record<string, unknown>
  /** 0-based source line the table starts at, for "reveal in page" navigation. */
  line: number
}

/** Wraps a blockquote in the container div its CSS class expects (matching
 * the current theme's actual stylesheet, not every variant the original MPX
 * themes ever used) — "paper" and "flavortext" get their own wrapper class,
 * plain/"read"/colors share the generic one. "flowchart"/"flowchart-with-link"
 * get no wrapper at all: the theme puts that variant's spacing and connecting
 * line directly on the <blockquote> itself, and a wrapper's own padding/
 * overflow clips the border image and breaks the line's alignment. */
function wrapClassForBlockquote(blockquoteClass: string | undefined): string | undefined {
  if (blockquoteClass === 'paper') {
    return 'blockquote-paper-wrap'
  }
  if (blockquoteClass === 'flavortext') {
    return 'blockquote-flavortext-wrap'
  }
  if (blockquoteClass === 'flowchart' || blockquoteClass === 'flowchart-with-link') {
    return undefined
  }
  return 'blockquote-wrap'
}

/** Resolves a `value | (() => value)` render option — same getter-vs-value
 * flexibility used for `measurement`/`language`/`overrides`/`*DisplayDefaults`,
 * so preview rendering re-reads the live workspace setting on every render
 * call instead of freezing it for the VSCode session's single markdown-it
 * instance. */
function resolveOption<T>(value: T | (() => T) | undefined, fallback: T): T {
  if (typeof value === 'function') {
    return (value as () => T)()
  }
  return value ?? fallback
}

function firstClass(token: Token): string | undefined {
  const value = token.attrGet('class')
  return typeof value === 'string' ? value.split(/\s+/)[0] : undefined
}

function installBlockquoteWrapping(markdown: MarkdownItInstance): void {
  const defaultOpen =
    markdown.renderer.rules.blockquote_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  const defaultClose =
    markdown.renderer.rules.blockquote_close ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

  // blockquote_close carries no class (markdown-it-attrs only sets it on the
  // matching open token), so a stack pairs each close with its own open's
  // wrap decision — LIFO works even with nested blockquotes.
  const wrapClassStack: (string | undefined)[] = []

  markdown.renderer.rules.blockquote_open = (tokens, idx, options, env, self) => {
    const wrapClass = wrapClassForBlockquote(firstClass(tokens[idx]))
    wrapClassStack.push(wrapClass)
    const rendered = defaultOpen(tokens, idx, options, env, self)
    return wrapClass ? `<div class="${wrapClass}">${rendered}` : rendered
  }
  markdown.renderer.rules.blockquote_close = (tokens, idx, options, env, self) => {
    const wrapClass = wrapClassStack.pop()
    const rendered = defaultClose(tokens, idx, options, env, self)
    return wrapClass ? `${rendered}</div>` : rendered
  }
}

function lineText(state: StateBlock, line: number): string {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])
}

/** Silently consumes a leading "---\n...\n---" front-matter block so it never
 * appears in the rendered preview (the built .module never sees it at all —
 * front matter isn't part of a page's HTML content either way). */
function installFrontMatterHiding(markdown: MarkdownItInstance): void {
  const rule = (state: StateBlock, startLine: number, _endLine: number, silent: boolean): boolean => {
    if (startLine !== 0 || state.tShift[startLine] !== 0) {
      return false
    }
    if (lineText(state, 0).trim() !== '---') {
      return false
    }
    for (let line = 1; line < state.lineMax; line += 1) {
      if (lineText(state, line).trim() === '---') {
        if (!silent) {
          state.line = line + 1
        }
        return true
      }
    }
    return false
  }
  markdown.block.ruler.before('hr', 'mpx_front_matter', rule)
}

/** EncounterPlus-specific Markdown extension: `![alt](src =WIDTHxHEIGHT)` (or
 * `=WIDTHx` / `=xHEIGHT` for a single dimension) sets width/height attributes
 * on the rendered <img>. Reuses the same 'image' token type as the standard
 * rule, so it goes through installImageRendering (captions, path fixes) too. */
function imageWithSize(state: StateInline, silent: boolean): boolean {
  const startPos = state.pos
  const maxPos = state.posMax

  if (state.src.charCodeAt(startPos) !== 0x21 || state.src.charCodeAt(startPos + 1) !== 0x5b) {
    return false
  }

  const labelStart = startPos + 2
  const labelEnd = state.md.helpers.parseLinkLabel(state, startPos + 1, false)
  if (labelEnd < 0 || state.src.charCodeAt(labelEnd + 1) !== 0x28) {
    return false
  }

  let pos = labelEnd + 2
  while (pos < maxPos && /\s/.test(state.src[pos])) {
    pos += 1
  }

  const destination = state.md.helpers.parseLinkDestination(state.src, pos, maxPos)
  if (!destination.ok) {
    return false
  }
  const source = state.md.normalizeLink(destination.str)
  if (!state.md.validateLink(source)) {
    return false
  }
  pos = destination.pos

  const whitespaceStart = pos
  while (pos < maxPos && /\s/.test(state.src[pos])) {
    pos += 1
  }
  if (pos === whitespaceStart) {
    return false
  }

  const dimensions = /^=(\d*)x(\d*)/.exec(state.src.slice(pos, maxPos))
  if (!dimensions || (!dimensions[1] && !dimensions[2])) {
    return false
  }
  const width = dimensions[1]
  const height = dimensions[2]
  if ((width && Number.parseInt(width, 10) <= 0) || (height && Number.parseInt(height, 10) <= 0)) {
    return false
  }

  pos += dimensions[0].length
  while (pos < maxPos && /\s/.test(state.src[pos])) {
    pos += 1
  }
  if (state.src.charCodeAt(pos) !== 0x29) {
    return false
  }
  pos += 1

  if (!silent) {
    const content = state.src.slice(labelStart, labelEnd)
    const children: Token[] = []
    state.md.inline.parse(content, state.md, state.env, children)

    const token = state.push('image', 'img', 0)
    token.attrs = [
      ['src', source],
      ['alt', ''],
    ]
    token.children = children
    token.content = content
    if (width) {
      token.attrSet('width', width)
    }
    if (height) {
      token.attrSet('height', height)
    }
  }

  state.pos = pos
  state.posMax = maxPos
  return true
}

function installImageSizeSyntax(markdown: MarkdownItInstance): void {
  markdown.inline.ruler.before('image', 'mpx_image_size', imageWithSize)
}

/** Handles both image concerns together, since both rewrite the same
 * renderer rule:
 * - In preview only: a page's Markdown file lives in pages/, one folder
 *   below the project root where images/ actually is — the built .module
 *   has no such nesting, so path adjustment only applies to preview.
 * - Always: an image marked with the "caption" class (via markdown-it-attrs,
 *   e.g. `![Alt text](images/x.png){.caption}`) renders as
 *   <figure><img>...<figcaption>Alt text</figcaption></figure> instead of a
 *   bare <img> — "caption" itself isn't a real CSS class, just a marker, so
 *   it's removed from the rendered <img>'s class list. */
function installImageRendering(markdown: MarkdownItInstance, options: MarkdownRendererOptions): void {
  const defaultImage =
    markdown.renderer.rules.image ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts))

  markdown.renderer.rules.image = (tokens, idx, opts, env, self) => {
    const token = tokens[idx]

    const srcValue = token.attrGet('src')
    const src = typeof srcValue === 'string' ? srcValue : undefined
    if (src?.startsWith('/images/')) {
      // EncounterPlus expects a relative path within the built module — a
      // leading "/" doesn't resolve there, even though it's a harmless way
      // to write it in the source Markdown.
      const relativeSrc = src.slice(1)
      token.attrSet('src', options.preview ? `..${src}` : relativeSrc)
    } else if (src?.startsWith('images/') && options.preview) {
      token.attrSet('src', `../${src}`)
    }

    const classValue = token.attrGet('class')
    const classes: string[] = typeof classValue === 'string' ? classValue.split(/\s+/).filter(Boolean) : []
    const hasCaption = classes.includes('caption')
    const altText = token.children ? self.renderInlineAsText(token.children, opts, env) : ''

    if (!hasCaption || !altText) {
      return defaultImage(tokens, idx, opts, env, self)
    }

    const remainingClasses = classes.filter((className) => className !== 'caption')
    if (remainingClasses.length > 0) {
      token.attrSet('class', remainingClasses.join(' '))
    } else {
      token.attrs = token.attrs?.filter(([name]) => name !== 'class') ?? null
    }

    const imageHtml = defaultImage(tokens, idx, opts, env, self)
    return `<figure>${imageHtml}<figcaption>${altText}</figcaption></figure>`
  }
}

/** EncounterPlus's real renderer always roots a page's content in #page —
 * theme CSS targets that selector. Only applied around actual block content,
 * so inline-only fragments (e.g. a Compendium hover preview) aren't wrapped. */
function installPageWrapper(markdown: MarkdownItInstance): void {
  const defaultRender = markdown.renderer.render.bind(markdown.renderer)
  // A rule (e.g. a spell block's description) can call markdown.render()
  // again while already inside a render pass — this guard only wraps the
  // outermost call, so a nested fragment doesn't get its own stray #page.
  let rendering = false
  markdown.renderer.render = (tokens, options, env) => {
    if (rendering) {
      return defaultRender(tokens, options, env)
    }
    rendering = true
    try {
      const html = defaultRender(tokens, options, env)
      return tokens.some((token) => token.block) ? `<div id="page">${html}</div>` : html
    } finally {
      rendering = false
    }
  }
}

/** Renders a fenced ` ```spell ` block into the `.spell-block` markup the
 * theme's CSS already styles, and records the parsed data on `env` (keyed
 * per page during a build) so it can be merged into spells.json alongside
 * standalone spell files — matching how the original Module Packer and old
 * MPX both supported spells authored directly inside a page. */
function installSpellBlockRendering(markdown: MarkdownItInstance, options: MarkdownRendererOptions): void {
  const defaultFence =
    markdown.renderer.rules.fence ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts))

  markdown.renderer.rules.fence = (tokens, idx, opts, envArg: MpxMarkdownEnvironment | undefined, self) => {
    const env: MpxMarkdownEnvironment = envArg ?? {}
    const token = tokens[idx]
    if (token.info.trim().toLowerCase() !== 'spell') {
      return defaultFence(tokens, idx, opts, env, self)
    }

    const { data, issues } = parseSpellBlock(token.content)
    if (issues.length > 0) {
      const messages = issues.map((issue) => escapeHtml(issue.message)).join(' ')
      return `<div class="spell-block-error">${messages}</div>`
    }

    env.inlineSpells ??= []
    env.inlineSpells.push({ data, issues, line: token.map?.[0] ?? 0 })

    const measurement = resolveOption(options.measurement, 'imperial' as MeasurementSystem)
    const language = resolveOption(options.language, 'en' as ContentLanguage)
    const overrides = resolveOption(options.overrides, undefined as CatalogOverrides | undefined)
    const displayDefaults = resolveOption(options.spellDisplayDefaults, undefined as SpellDisplayDefaults | undefined)
    return renderSpellBlockHtml(data, markdown, { measurement, language, overrides, preview: options.preview, displayDefaults })
  }
}

/** Renders a fenced ` ```item ` block — same mechanism as
 * installSpellBlockRendering (see its comment), for items instead of
 * spells. Chained after installSpellBlockRendering, so its own
 * `defaultFence` falls back to the spell handler for anything that isn't
 * an item fence, which in turn falls back further for a plain code block. */
function installItemBlockRendering(markdown: MarkdownItInstance, options: MarkdownRendererOptions): void {
  const defaultFence =
    markdown.renderer.rules.fence ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts))

  markdown.renderer.rules.fence = (tokens, idx, opts, envArg: MpxMarkdownEnvironment | undefined, self) => {
    const env: MpxMarkdownEnvironment = envArg ?? {}
    const token = tokens[idx]
    if (token.info.trim().toLowerCase() !== 'item') {
      return defaultFence(tokens, idx, opts, env, self)
    }

    const { data, issues } = parseItemBlock(token.content)
    if (issues.length > 0) {
      const messages = issues.map((issue) => escapeHtml(issue.message)).join(' ')
      return `<div class="item-block-error">${messages}</div>`
    }

    env.inlineItems ??= []
    env.inlineItems.push({ data, issues, line: token.map?.[0] ?? 0 })

    const measurement = resolveOption(options.measurement, 'imperial' as MeasurementSystem)
    const language = resolveOption(options.language, 'en' as ContentLanguage)
    const overrides = resolveOption(options.overrides, undefined as CatalogOverrides | undefined)
    const displayDefaults = resolveOption(options.itemDisplayDefaults, undefined as ItemDisplayDefaults | undefined)
    return renderItemBlockHtml(data, markdown, { measurement, language, overrides, preview: options.preview, displayDefaults })
  }
}

/** Renders a fenced ` ```monster ` block — same mechanism as
 * installSpellBlockRendering/installItemBlockRendering, chained after item
 * so its own `defaultFence` falls back through item then spell then a
 * plain code block. */
function installMonsterBlockRendering(markdown: MarkdownItInstance, options: MarkdownRendererOptions): void {
  const defaultFence =
    markdown.renderer.rules.fence ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts))

  markdown.renderer.rules.fence = (tokens, idx, opts, envArg: MpxMarkdownEnvironment | undefined, self) => {
    const env: MpxMarkdownEnvironment = envArg ?? {}
    const token = tokens[idx]
    if (token.info.trim().toLowerCase() !== 'monster') {
      return defaultFence(tokens, idx, opts, env, self)
    }

    const { data, issues } = parseMonsterBlock(token.content)
    if (issues.length > 0) {
      const messages = issues.map((issue) => escapeHtml(issue.message)).join(' ')
      return `<div class="monster-block-error">${messages}</div>`
    }

    env.inlineMonsters ??= []
    env.inlineMonsters.push({ data, issues, line: token.map?.[0] ?? 0 })

    const measurement = resolveOption(options.measurement, 'imperial' as MeasurementSystem)
    const language = resolveOption(options.language, 'en' as ContentLanguage)
    const overrides = resolveOption(options.overrides, undefined as CatalogOverrides | undefined)
    const displayDefaults = resolveOption(options.monsterDisplayDefaults, undefined as MonsterDisplayDefaults | undefined)
    // markdown-it-attrs already parsed a trailing ` ```monster {.blue} `
    // class annotation off the info string and onto the token by this
    // point — same syntax an image caption ({.caption}) or blockquote
    // variant ({.paper}) already uses elsewhere in this renderer.
    const blockClassValue = token.attrGet('class')
    const blockClass = typeof blockClassValue === 'string' ? blockClassValue : undefined
    return renderMonsterBlockHtml(data, markdown, { measurement, language, overrides, preview: options.preview, displayDefaults, blockClass })
  }
}

function hasClass(token: Token, name: string): boolean {
  const value = token.attrGet('class')
  return typeof value === 'string' && value.split(/\s+/).includes(name)
}

/** Reads a scalar front-matter field (e.g. "name: My Page") directly off the
 * raw source — only used as a fallback when the caller hasn't already parsed
 * front matter and set env.pageName/pageSlug (the real VSCode preview, which
 * drives render() itself and passes the untouched file text, front matter
 * included, since installFrontMatterHiding only hides it at render time
 * rather than stripping it beforehand). Not a general YAML parser: just
 * enough to recover a plain scalar value for the roll table naming fallback. */
function extractFrontMatterField(src: string, field: string): string | undefined {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src)
  if (!block) {
    return undefined
  }
  const line = block[1].split(/\r?\n/).find((candidate) => new RegExp(`^${field}\\s*:`).test(candidate))
  if (!line) {
    return undefined
  }
  const value = line.slice(line.indexOf(':') + 1).trim().replace(/^['"]|['"]$/g, '')
  return value.length > 0 ? value : undefined
}

function findClosingToken(tokens: Token[], start: number, openType: string, closeType: string): number {
  let depth = 0
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].type === openType) {
      depth += 1
    } else if (tokens[index].type === closeType) {
      depth -= 1
      if (depth === 0) {
        return index
      }
    }
  }
  return tokens.length - 1
}

function tokenText(token: Token | undefined): string {
  if (!token?.children) {
    return token?.content ?? ''
  }
  return token.children
    .map((child) => {
      if (child.type === 'text' || child.type === 'code_inline' || child.type === 'html_inline') {
        return child.content
      }
      if (child.type === 'image') {
        return child.attrGet('alt') ?? child.content
      }
      if (child.type === 'softbreak' || child.type === 'hardbreak') {
        return '\n'
      }
      return ''
    })
    .join('')
    .replace(/\{\.(?:no-repeat|each-row)\}\s*$/i, '')
    .trim()
}

function rowCells(tokens: Token[], start: number, end: number, cellType: 'th_open' | 'td_open'): string[] {
  const cells: string[] = []
  for (let index = start; index < end; index += 1) {
    if (tokens[index].type !== cellType) {
      continue
    }
    cells.push(tokenText(tokens[index + 1]))
  }
  return cells
}

type RollTableMode = 'normal' | 'noRepeat' | 'eachRow'

/** Finds a `[dice](/roll/...)` link among the header row's first inline
 * token's children and its optional `{.no-repeat}`/`{.each-row}` marker.
 * Since this rule runs after markdown-it-attrs' own core rule, that plugin
 * has already turned a `{.no-repeat}` immediately after the link into a
 * `class="no-repeat"` on the link itself — but fall back to a raw trailing
 * text marker too, in case a table shape (e.g. no space before the closing
 * cell pipe) leaves it unconsumed, matching the original Module
 * Packer/MPX1 behavior this reimplements. */
function rollLink(inline: Token | undefined): { token: Token; mode: RollTableMode } | undefined {
  for (const child of inline?.children ?? []) {
    if (child.type !== 'link_open') {
      continue
    }
    const destination = child.attrGet('href')
    if (typeof destination !== 'string' || !destination.startsWith('/roll/')) {
      continue
    }
    let mode: RollTableMode = 'normal'
    if (hasClass(child, 'no-repeat')) {
      mode = 'noRepeat'
    } else if (hasClass(child, 'each-row')) {
      mode = 'eachRow'
    }
    for (const sibling of inline?.children ?? []) {
      if (sibling.type !== 'text') {
        continue
      }
      const trimmed = sibling.content.trim()
      if (/^\{\.no-repeat\}$/i.test(trimmed)) {
        mode = 'noRepeat'
        sibling.content = ''
      } else if (/^\{\.each-row\}$/i.test(trimmed)) {
        mode = 'eachRow'
        sibling.content = ''
      }
    }
    return { token: child, mode }
  }
  return undefined
}

/** Detects a Markdown table whose header's first cell links to `/roll/...`
 * (e.g. `[2d6](/roll/2d6)`) and records it on env.inlineRollTables so a build
 * can merge it into tables.json — the same "no separate file needed"
 * behavior the original Module Packer and old MPX both supported. A table's
 * name/slug come from the nearest preceding heading carrying a
 * `{.table-title}` class if there is one, otherwise from
 * "{page name} — {result column headers}" (mirroring the original
 * heuristic), with an in-page "(2)", "(3)"... suffix on a name collision. */
function installRollTableDetection(markdown: MarkdownItInstance, options: MarkdownRendererOptions): void {
  // Runs after markdown-it-attrs' own core rule (registered `before('linkify', ...)`,
  // i.e. right after `inline`) rather than right after `inline` itself, so a
  // `## Heading {.table-title}` heading already carries its class attribute
  // by the time this rule reads it.
  markdown.core.ruler.after('curly_attributes', 'mpx_roll_tables', (state) => {
    const env = state.env as MpxMarkdownEnvironment | undefined
    const pageName = env?.pageName ?? extractFrontMatterField(state.src, 'name') ?? 'Page'
    const pageSlug = env?.pageSlug ?? extractFrontMatterField(state.src, 'slug') ?? 'page'
    const preview = options.preview === true
    const language = resolveOption(options.language, 'en' as ContentLanguage)
    let precedingTableTitle: string | undefined

    for (let index = 0; index < state.tokens.length; index += 1) {
      const token = state.tokens[index]

      // {.table-title} is a real theme CSS class meant for a short caption
      // above a table — authors reach for it on either a heading (`## Foo
      // {.table-title}`) or a plain paragraph (`Foo {.table-title}`), so
      // both count as "the nearest preceding title" here.
      if (token.type === 'heading_open' || token.type === 'paragraph_open') {
        const inline = state.tokens[index + 1]
        precedingTableTitle = hasClass(token, 'table-title') ? tokenText(inline) || undefined : undefined
        continue
      }

      if (token.type !== 'table_open') {
        continue
      }
      const tableEnd = findClosingToken(state.tokens, index, 'table_open', 'table_close')
      const headerRowStart = state.tokens.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex > index && candidateIndex < tableEnd && candidate.type === 'tr_open',
      )
      if (headerRowStart < 0) {
        index = tableEnd
        precedingTableTitle = undefined
        continue
      }
      const headerRowEnd = findClosingToken(state.tokens, headerRowStart, 'tr_open', 'tr_close')
      const firstHeaderInline = state.tokens
        .slice(headerRowStart, headerRowEnd)
        .find((candidate) => candidate.type === 'inline')
      const detected = rollLink(firstHeaderInline)
      if (!detected) {
        index = tableEnd
        precedingTableTitle = undefined
        continue
      }

      const columns = rowCells(state.tokens, headerRowStart, headerRowEnd, 'th_open').map((name) => ({ name }))
      const rows: string[][] = []
      for (let rowStart = headerRowEnd + 1; rowStart < tableEnd; rowStart += 1) {
        if (state.tokens[rowStart].type !== 'tr_open') {
          continue
        }
        const rowEnd = findClosingToken(state.tokens, rowStart, 'tr_open', 'tr_close')
        const cells = rowCells(state.tokens, rowStart, rowEnd, 'td_open')
        if (cells.length > 0) {
          rows.push(cells)
        }
        rowStart = rowEnd
      }

      const resultHeading =
        columns
          .slice(1)
          .map((column) => column.name)
          .filter(Boolean)
          .join(' - ') || 'Roll table'
      const baseName = precedingTableTitle ?? `${pageName} — ${resultHeading}`
      const baseSlug = `${pageSlug}-${slugify(precedingTableTitle ?? resultHeading) || 'roll-table'}`

      let duplicateIndex = 1
      let slug = baseSlug
      while (env?.inlineRollTables?.some((table) => table.data.slug === slug)) {
        duplicateIndex += 1
        slug = `${baseSlug}-${duplicateIndex}`
      }
      const name = duplicateIndex === 1 ? baseName : `${baseName} (${duplicateIndex})`

      detected.token.attrSet('href', `/table-roll/${slug}`)
      // The {.no-repeat}/{.each-row} marker is only meant to select rollMode,
      // not to leave a stray unstyled class on the rendered link.
      const classIndex = detected.token.attrIndex('class')
      if (classIndex >= 0 && detected.token.attrs) {
        detected.token.attrs.splice(classIndex, 1)
      }

      if (env) {
        env.inlineRollTables ??= []
        env.inlineRollTables.push({
          data: {
            name,
            slug,
            columns,
            rows,
            ...(detected.mode === 'normal' ? {} : { rollMode: detected.mode }),
          },
          line: token.map?.[0] ?? 0,
        })
      }

      if (preview) {
        const label = language === 'fr' ? 'Détectée comme roll table' : 'Detected as roll table'
        const caption = `<div class="mpx-roll-table-caption"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M12 22V12M3 7l9 5 9-5"/></svg>${escapeHtml(label)} — <span class="mpx-roll-table-caption-slug">${escapeHtml(slug)}</span></div>`
        const captionToken = new state.Token('html_block', '', 0)
        captionToken.content = caption
        captionToken.block = true
        state.tokens.splice(tableEnd + 1, 0, captionToken)
      }

      precedingTableTitle = undefined
      index = tableEnd
    }
  })
}

export function createMarkdownRenderer(options: MarkdownRendererOptions = {}): MarkdownItInstance {
  const markdown = new MarkdownIt({ html: true, linkify: true })
  // markdown-it 15 dropped `utils.assign` (a pre-ES2015 Object.assign shim,
  // no longer needed natively) — markdown-it-multimd-table@4.2.3 (its latest
  // release) still calls it once, at registration, so this restores just
  // enough of the old utils surface for that one call to succeed.
  ;(markdown.utils as unknown as { assign?: typeof Object.assign }).assign ??= Object.assign
  markdown
    .use(anchor)
    .use(attrs)
    .use(mark)
    .use(multimdTable)
    .use(sub)
    .use(sup)
    .use(underline)

  installBlockquoteWrapping(markdown)
  installImageSizeSyntax(markdown)
  installImageRendering(markdown, options)
  installSpellBlockRendering(markdown, options)
  installItemBlockRendering(markdown, options)
  installMonsterBlockRendering(markdown, options)
  installRollTableDetection(markdown, options)

  if (options.preview) {
    installFrontMatterHiding(markdown)
    installPageWrapper(markdown)
  }

  return markdown
}
