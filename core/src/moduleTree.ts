import matter from 'gray-matter'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export type ModuleTreeNodeKind = 'page' | 'group' | 'map' | 'encounter'

export interface ModuleTreeNode {
  kind: ModuleTreeNodeKind
  name: string
  slug?: string
  filePath: string
  children: ModuleTreeNode[]
}

interface ParsedEntry {
  kind: ModuleTreeNodeKind
  name: string
  slug?: string
  parentSlug?: string
  rank: number
  filePath: string
}

function trimmedOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function numericRankOf(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

async function listFilesRecursively(root: string, extension: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(entryPath, extension)))
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(entryPath)
    }
  }
  return files
}

async function parsePageFile(filePath: string): Promise<ParsedEntry> {
  const source = await readFile(filePath, 'utf8')
  const data = matter(source).data
  return {
    kind: 'page',
    name: trimmedOrUndefined(data.name) ?? basename(filePath, '.md'),
    slug: trimmedOrUndefined(data.slug),
    parentSlug: trimmedOrUndefined(data.parent),
    rank: numericRankOf(data.rank),
    filePath,
  }
}

async function parseJsonEntryFile(
  filePath: string,
  kind: Exclude<ModuleTreeNodeKind, 'page'>,
): Promise<ParsedEntry> {
  const source = await readFile(filePath, 'utf8')
  const data = JSON.parse(source) as Record<string, unknown>
  const slug = trimmedOrUndefined(data.slug)
  const name =
    (kind === 'group' ? trimmedOrUndefined(data.name) : undefined) ??
    slug ??
    basename(filePath, '.json')
  return {
    kind,
    name,
    slug,
    parentSlug: trimmedOrUndefined(data.parent),
    rank: numericRankOf(data.rank),
    filePath,
  }
}

function compareEntries(a: ParsedEntry, b: ParsedEntry): number {
  return a.rank - b.rank || a.name.localeCompare(b.name)
}

function buildHierarchy(entries: ParsedEntry[]): ModuleTreeNode[] {
  entries.sort(compareEntries)

  const entriesBySlug = new Map<string, ParsedEntry[]>()
  for (const entry of entries) {
    if (!entry.slug) {
      continue
    }
    const matches = entriesBySlug.get(entry.slug) ?? []
    matches.push(entry)
    entriesBySlug.set(entry.slug, matches)
  }

  const candidateParent = new Map<ParsedEntry, ParsedEntry>()
  for (const entry of entries) {
    if (!entry.parentSlug) {
      continue
    }
    const matches = entriesBySlug.get(entry.parentSlug)
    if (matches?.length === 1 && matches[0] !== entry) {
      candidateParent.set(entry, matches[0])
    }
  }

  const validAncestry = new Map<ParsedEntry, boolean>()
  function canNest(entry: ParsedEntry, visiting: Set<ParsedEntry>): boolean {
    const cached = validAncestry.get(entry)
    if (cached !== undefined) {
      return cached
    }
    if (visiting.has(entry)) {
      return false
    }
    const parent = candidateParent.get(entry)
    if (!parent) {
      validAncestry.set(entry, true)
      return true
    }
    const nextVisiting = new Set(visiting)
    nextVisiting.add(entry)
    const result = canNest(parent, nextVisiting)
    validAncestry.set(entry, result)
    return result
  }

  const childrenByParent = new Map<ParsedEntry, ParsedEntry[]>()
  const roots: ParsedEntry[] = []
  for (const entry of entries) {
    const parent = candidateParent.get(entry)
    if (parent && canNest(entry, new Set())) {
      const children = childrenByParent.get(parent) ?? []
      children.push(entry)
      childrenByParent.set(parent, children)
    } else {
      roots.push(entry)
    }
  }

  function toNode(entry: ParsedEntry): ModuleTreeNode {
    return {
      kind: entry.kind,
      name: entry.name,
      slug: entry.slug,
      filePath: entry.filePath,
      children: (childrenByParent.get(entry) ?? []).sort(compareEntries).map(toNode),
    }
  }

  return roots.sort(compareEntries).map(toNode)
}

export async function parseModuleTree(moduleRoot: string): Promise<ModuleTreeNode[]> {
  const [pageFiles, groupFiles, mapFiles, encounterFiles] = await Promise.all([
    listFilesRecursively(join(moduleRoot, 'pages'), '.md'),
    listFilesRecursively(join(moduleRoot, 'groups'), '.json'),
    listFilesRecursively(join(moduleRoot, 'maps'), '.json'),
    listFilesRecursively(join(moduleRoot, 'encounters'), '.json'),
  ])

  const entries = await Promise.all([
    ...pageFiles.map((filePath) => parsePageFile(filePath)),
    ...groupFiles.map((filePath) => parseJsonEntryFile(filePath, 'group')),
    ...mapFiles.map((filePath) => parseJsonEntryFile(filePath, 'map')),
    ...encounterFiles.map((filePath) => parseJsonEntryFile(filePath, 'encounter')),
  ])

  return buildHierarchy(entries)
}
