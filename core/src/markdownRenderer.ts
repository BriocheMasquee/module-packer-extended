import MarkdownIt from 'markdown-it'
import { escapeHtml, parseSpellBlock, renderSpellBlockHtml } from './spellBlock.js'
import type { SpellDisplayDefaults } from './spellBlock.js'
import type { MeasurementSystem } from './localization.js'
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
  /** Project-level fallback for a spell's `show*` toggles when its own YAML
   * leaves one absent. Same getter-vs-value flexibility as `measurement`,
   * for the same live-preview-refresh reason. */
  spellDisplayDefaults?: SpellDisplayDefaults | (() => SpellDisplayDefaults)
}

/** Collected while rendering a page, so the build can merge inline
 * Compendium blocks into the same output as standalone files. Not read
 * during preview rendering. */
export interface MpxMarkdownEnvironment {
  inlineSpells?: InlineSpellBlock[]
}

export interface InlineSpellBlock {
  data: Record<string, unknown>
  issues: ValidationIssue[]
  /** 0-based source line the fence starts at, for "reveal in page" navigation. */
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

function firstClass(token: MarkdownIt.Token): string | undefined {
  return token.attrGet('class')?.split(/\s+/)[0]
}

function installBlockquoteWrapping(markdown: MarkdownIt): void {
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

function lineText(state: MarkdownIt.StateBlock, line: number): string {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])
}

/** Silently consumes a leading "---\n...\n---" front-matter block so it never
 * appears in the rendered preview (the built .module never sees it at all —
 * front matter isn't part of a page's HTML content either way). */
function installFrontMatterHiding(markdown: MarkdownIt): void {
  const rule: MarkdownIt.ParserBlock.RuleBlock = (state, startLine, _endLine, silent) => {
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
function imageWithSize(state: MarkdownIt.StateInline, silent: boolean): boolean {
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
    const children: MarkdownIt.Token[] = []
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

function installImageSizeSyntax(markdown: MarkdownIt): void {
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
function installImageRendering(markdown: MarkdownIt, options: MarkdownRendererOptions): void {
  const defaultImage =
    markdown.renderer.rules.image ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts))

  markdown.renderer.rules.image = (tokens, idx, opts, env, self) => {
    const token = tokens[idx]

    const src = token.attrGet('src')
    if (src?.startsWith('/images/')) {
      // EncounterPlus expects a relative path within the built module — a
      // leading "/" doesn't resolve there, even though it's a harmless way
      // to write it in the source Markdown.
      const relativeSrc = src.slice(1)
      token.attrSet('src', options.preview ? `..${src}` : relativeSrc)
    } else if (src?.startsWith('images/') && options.preview) {
      token.attrSet('src', `../${src}`)
    }

    const classes = token.attrGet('class')?.split(/\s+/).filter(Boolean) ?? []
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
function installPageWrapper(markdown: MarkdownIt): void {
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
function installSpellBlockRendering(markdown: MarkdownIt, options: MarkdownRendererOptions): void {
  const defaultFence =
    markdown.renderer.rules.fence ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts))

  markdown.renderer.rules.fence = (tokens, idx, opts, env: MpxMarkdownEnvironment, self) => {
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

    const measurement = typeof options.measurement === 'function' ? options.measurement() : (options.measurement ?? 'imperial')
    const displayDefaults =
      typeof options.spellDisplayDefaults === 'function' ? options.spellDisplayDefaults() : options.spellDisplayDefaults
    return renderSpellBlockHtml(data, markdown, { measurement, preview: options.preview, displayDefaults })
  }
}

export function createMarkdownRenderer(options: MarkdownRendererOptions = {}): MarkdownIt {
  const markdown = new MarkdownIt({ html: true, linkify: true })
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

  if (options.preview) {
    installFrontMatterHiding(markdown)
    installPageWrapper(markdown)
  }

  return markdown
}
