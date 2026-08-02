import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { slugify } from './slug.js'

export type ContentEntryKind = 'page' | 'group' | 'map' | 'encounter'

export interface CreatedContentEntry {
  slug: string
  filePath: string
}

const FOLDER_BY_KIND: Record<ContentEntryKind, string> = {
  page: 'pages',
  group: 'groups',
  map: 'maps',
  encounter: 'encounters',
}

function alreadyExistsError(kind: ContentEntryKind, slug: string): Error {
  return new Error(`A ${kind} with slug "${slug}" already exists.`)
}

async function writeNewFile(filePath: string, content: string): Promise<void> {
  await mkdir(join(filePath, '..'), { recursive: true })
  await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' })
}

export async function createPage(
  moduleRoot: string,
  name: string,
): Promise<CreatedContentEntry> {
  const slug = slugify(name)
  const filePath = join(moduleRoot, FOLDER_BY_KIND.page, `${slug}.md`)
  const frontMatter = `---\nname: ${name}\nslug: ${slug}\nrank: 0\nparent:\n---\n`

  try {
    await writeNewFile(filePath, frontMatter)
  } catch (error) {
    throw (error as NodeJS.ErrnoException).code === 'EEXIST' ? alreadyExistsError('page', slug) : error
  }
  return { slug, filePath }
}

async function createJsonEntry(
  kind: Exclude<ContentEntryKind, 'page'>,
  moduleRoot: string,
  name: string,
  extraFields: Record<string, string>,
): Promise<CreatedContentEntry> {
  const slug = slugify(name)
  const filePath = join(moduleRoot, FOLDER_BY_KIND[kind], `${slug}.json`)
  const data = { name, slug, rank: 0, parent: '', ...extraFields }

  try {
    await writeNewFile(filePath, `${JSON.stringify(data, null, 2)}\n`)
  } catch (error) {
    throw (error as NodeJS.ErrnoException).code === 'EEXIST' ? alreadyExistsError(kind, slug) : error
  }
  return { slug, filePath }
}

export function createGroup(moduleRoot: string, name: string): Promise<CreatedContentEntry> {
  return createJsonEntry('group', moduleRoot, name, {})
}

export function createMapReference(
  moduleRoot: string,
  name: string,
): Promise<CreatedContentEntry> {
  return createJsonEntry('map', moduleRoot, name, { path: 'maps/', descr: '' })
}

export function createEncounterReference(
  moduleRoot: string,
  name: string,
): Promise<CreatedContentEntry> {
  return createJsonEntry('encounter', moduleRoot, name, { path: 'encounters/', descr: '' })
}
