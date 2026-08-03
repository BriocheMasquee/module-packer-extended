import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import matter from 'gray-matter'
import { listFilesRecursively } from './fileScan.js'
import { createMarkdownRenderer } from './markdownRenderer.js'
import type { MpxMarkdownEnvironment } from './markdownRenderer.js'
import { isNonEmptyString } from './compendiumShared.js'

export interface InlineSpellSummary {
  name: string
  pageFilePath: string
  /** 0-based source line the ```spell fence starts at, for "reveal in page" navigation. */
  line: number
}

/** Lightweight scan for the Compendium panel: finds every inline ```spell
 * block across a project's pages, so it can be listed as a virtual entry
 * alongside standalone spells/*.json files. Reuses the exact same renderer
 * buildModule does, so what's listed here always matches what actually gets
 * built into spells.json. Malformed blocks (the ones that would render a
 * spell-block-error) are silently skipped — build validation is what
 * surfaces those, not this panel. */
export async function findInlineSpells(moduleRoot: string): Promise<InlineSpellSummary[]> {
  const markdown = createMarkdownRenderer()
  const results: InlineSpellSummary[] = []

  for (const filePath of await listFilesRecursively(join(moduleRoot, 'pages'), '.md')) {
    let raw: string
    let content: string
    try {
      raw = await readFile(filePath, 'utf8')
      content = matter(raw).content
    } catch {
      continue
    }
    // gray-matter's `content` is a line-for-line suffix of the original
    // file (front matter stripped from the front, nothing reflowed), so the
    // line offset it introduces is just the line-count difference — needed
    // to map a fence's content-relative line back to a real position in the
    // page file for "reveal in page" navigation.
    const lineOffset = raw.split('\n').length - content.split('\n').length
    const env: MpxMarkdownEnvironment = {}
    markdown.render(content, env)
    for (const block of env.inlineSpells ?? []) {
      const name = isNonEmptyString(block.data.name) ? block.data.name : 'Untitled Spell'
      results.push({ name, pageFilePath: filePath, line: block.line + lineOffset })
    }
  }

  return results
}
