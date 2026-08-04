import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import matter from 'gray-matter'
import { listFilesRecursively } from './fileScan.js'
import { createMarkdownRenderer } from './markdownRenderer.js'
import type { MpxMarkdownEnvironment } from './markdownRenderer.js'
import { isNonEmptyString } from './compendiumShared.js'

export interface InlineRollTableSummary {
  name: string
  pageFilePath: string
  /** 0-based source line the table starts at, for "reveal in page" navigation. */
  line: number
}

/** Lightweight scan for the Compendium panel: finds every Markdown table
 * auto-detected as a roll table across a project's pages — same mechanism as
 * findInlineSpells (see its comment), for tables instead of ```spell blocks.
 * pageName/pageSlug are set from front matter so a table's default name
 * matches what a build would actually produce. */
export async function findInlineRollTables(moduleRoot: string): Promise<InlineRollTableSummary[]> {
  const markdown = createMarkdownRenderer()
  const results: InlineRollTableSummary[] = []

  for (const filePath of await listFilesRecursively(join(moduleRoot, 'pages'), '.md')) {
    let raw: string
    let parsed: matter.GrayMatterFile<string>
    try {
      raw = await readFile(filePath, 'utf8')
      parsed = matter(raw)
    } catch {
      continue
    }
    const content = parsed.content
    const lineOffset = raw.split('\n').length - content.split('\n').length
    const env: MpxMarkdownEnvironment = {
      pageName: isNonEmptyString(parsed.data.name) ? parsed.data.name : undefined,
      pageSlug: isNonEmptyString(parsed.data.slug) ? parsed.data.slug : undefined,
    }
    markdown.render(content, env)
    for (const block of env.inlineRollTables ?? []) {
      const name = isNonEmptyString(block.data.name) ? block.data.name : 'Untitled Roll Table'
      results.push({ name, pageFilePath: filePath, line: block.line + lineOffset })
    }
  }

  return results
}
