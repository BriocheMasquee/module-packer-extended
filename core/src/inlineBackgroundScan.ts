import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import matter from 'gray-matter'
import { listFilesRecursively } from './fileScan.js'
import { createMarkdownRenderer } from './markdownRenderer.js'
import type { MpxMarkdownEnvironment } from './markdownRenderer.js'
import { isNonEmptyString } from './compendiumShared.js'

export interface InlineBackgroundSummary {
  name: string
  pageFilePath: string
  /** 0-based source line the ```background fence starts at, for "reveal in page" navigation. */
  line: number
}

/** Lightweight scan for the Compendium panel: finds every inline ```background
 * block across a project's pages — same mechanism as findInlineItems (see
 * its comment) for backgrounds instead of items. */
export async function findInlineBackgrounds(moduleRoot: string): Promise<InlineBackgroundSummary[]> {
  const markdown = createMarkdownRenderer()
  const results: InlineBackgroundSummary[] = []

  for (const filePath of await listFilesRecursively(join(moduleRoot, 'pages'), '.md')) {
    let raw: string
    let content: string
    try {
      raw = await readFile(filePath, 'utf8')
      content = matter(raw).content
    } catch {
      continue
    }
    const lineOffset = raw.split('\n').length - content.split('\n').length
    const env: MpxMarkdownEnvironment = {}
    markdown.render(content, env)
    for (const block of env.inlineBackgrounds ?? []) {
      const name = isNonEmptyString(block.data.name) ? block.data.name : 'Untitled Background'
      results.push({ name, pageFilePath: filePath, line: block.line + lineOffset })
    }
  }

  return results
}
