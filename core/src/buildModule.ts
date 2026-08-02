import { createWriteStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import matter from 'gray-matter'
import { ZipFile } from 'yazl'
import { listFilesRecursively } from './fileScan.js'
import { readExportArchive } from './mapEncounterExport.js'
import { createMarkdownRenderer } from './markdownRenderer.js'
import { MODULE_CATEGORIES } from './moduleProject.js'
import { isValidSlug } from './slug.js'
import { incrementPatchVersion } from './version.js'
import { resolveProjectFile } from './projectPath.js'
import { createUuidV5, isUuid } from './uuid.js'

export interface BuildIssue {
  file: string
  message: string
}

export class ModuleBuildError extends Error {
  constructor(readonly issues: readonly BuildIssue[]) {
    super(`Module build failed with ${issues.length} issue(s).`)
    this.name = 'ModuleBuildError'
  }
}

export interface BuildSummary {
  outputPath: string
  pageCount: number
  groupCount: number
  mapCount: number
  encounterCount: number
  /** The version the .module archive was actually built with. */
  builtVersion: string
  /** Set only when autoIncrementVersion bumped module.json for the next build. */
  nextVersion?: string
}

type EntryKind = 'page' | 'group' | 'map' | 'encounter'

/** A page/group/map/encounter after its own file-level validation has passed,
 * ready for cross-entry parent/id resolution. `record` holds every output
 * field except `id` and `parentId`, which are filled in once parents and ids
 * are resolved across the whole entry set. */
interface ResolvedEntry {
  kind: EntryKind
  relativePath: string
  slug: string
  rank: number
  parentSlug?: string
  explicitId?: string
  record: Record<string, unknown>
}

const RESERVED_RESOURCE_NAMES = new Set([
  'module.json',
  'pages.json',
  'groups.json',
  'maps.json',
  'encounters.json',
  'items.json',
  'spells.json',
  'tables.json',
  'monsters.json',
])
const RESERVED_RESOURCE_PREFIXES = ['images/', 'assets/', 'items/', 'spells/', 'monsters/']

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

const MODULE_JSON_OPTIONAL_FIELDS = [
  'acronym',
  'category',
  'author',
  'shortDescr',
  'descr',
  'tags',
  'image',
  'banner',
  'website',
  'repository',
  'package',
]

/** EncounterPlus expects an unset optional field to be absent from
 * module.json, not an empty string/array — the project's own module.json
 * still keeps every field, for editing; only the built copy is trimmed. */
function stripEmptyOptionalFields(moduleJson: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...moduleJson }
  for (const field of MODULE_JSON_OPTIONAL_FIELDS) {
    const value = cleaned[field]
    const isEmpty = (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0)
    if (isEmpty) {
      delete cleaned[field]
    }
  }
  return cleaned
}

function numericOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function toPortablePath(root: string, filePath: string): string {
  return relative(root, filePath).split('\\').join('/')
}

async function readModuleJson(
  moduleRoot: string,
  issues: BuildIssue[],
): Promise<Record<string, unknown> | undefined> {
  const filePath = join(moduleRoot, 'module.json')
  let source: string
  try {
    source = await readFile(filePath, 'utf8')
  } catch {
    issues.push({ file: 'module.json', message: 'module.json is missing.' })
    return undefined
  }
  try {
    return JSON.parse(source) as Record<string, unknown>
  } catch (error) {
    issues.push({
      file: 'module.json',
      message: `module.json is not valid JSON: ${(error as Error).message}`,
    })
    return undefined
  }
}

async function checkResourceReference(
  moduleRoot: string,
  file: string,
  fieldLabel: string,
  resourcePath: string,
  issues: BuildIssue[],
): Promise<string | undefined> {
  let resolved: string
  try {
    resolved = resolveProjectFile(moduleRoot, resourcePath)
  } catch (error) {
    issues.push({ file, message: `${fieldLabel} ${(error as Error).message}` })
    return undefined
  }
  const exists = await readFile(resolved)
    .then(() => true)
    .catch(() => false)
  if (!exists) {
    issues.push({ file, message: `${fieldLabel} references a missing file: "${resourcePath}".` })
    return undefined
  }
  return resolved
}

async function validateModuleJson(
  moduleRoot: string,
  data: Record<string, unknown>,
  issues: BuildIssue[],
): Promise<void> {
  for (const field of ['name', 'slug', 'system', 'version']) {
    if (!isNonEmptyString(data[field])) {
      issues.push({ file: 'module.json', message: `Must contain a non-empty "${field}".` })
    }
  }
  if (isNonEmptyString(data.slug) && !isValidSlug(data.slug)) {
    issues.push({
      file: 'module.json',
      message: '"slug" must contain only lowercase letters, digits, and hyphens (no spaces or accents).',
    })
  }
  if (data.id !== undefined && !isUuid(data.id)) {
    issues.push({ file: 'module.json', message: '"id" must be a valid UUID when provided.' })
  }
  if (
    data.category !== undefined &&
    !(MODULE_CATEGORIES as readonly unknown[]).includes(data.category)
  ) {
    issues.push({
      file: 'module.json',
      message: `"category" must be one of ${MODULE_CATEGORIES.map((value) => `"${value}"`).join(', ')} when provided.`,
    })
  }
  if (data.tags !== undefined && (!Array.isArray(data.tags) || !data.tags.every((tag) => typeof tag === 'string'))) {
    issues.push({ file: 'module.json', message: '"tags" must be an array of strings when provided.' })
  }
  for (const field of ['image', 'banner']) {
    const resourcePath = data[field]
    if (isNonEmptyString(resourcePath)) {
      await checkResourceReference(moduleRoot, 'module.json', `"${field}"`, resourcePath, issues)
    }
  }
}

function validateSlugFormat(relativePath: string, slug: unknown, issues: BuildIssue[]): void {
  if (isNonEmptyString(slug) && !isValidSlug(slug)) {
    issues.push({
      file: relativePath,
      message: 'slug must contain only lowercase letters, digits, and hyphens (no spaces or accents).',
    })
  }
}

function validateParentShape(relativePath: string, data: Record<string, unknown>, issues: BuildIssue[]): void {
  if (
    data.parent !== undefined &&
    data.parent !== null &&
    data.parent !== '' &&
    !isNonEmptyString(data.parent)
  ) {
    issues.push({ file: relativePath, message: 'parent must be empty or a non-empty slug.' })
  }
}

async function readPages(moduleRoot: string, issues: BuildIssue[]): Promise<ResolvedEntry[]> {
  const markdown = createMarkdownRenderer()
  const entries: ResolvedEntry[] = []

  for (const filePath of await listFilesRecursively(join(moduleRoot, 'pages'), '.md')) {
    const relativePath = toPortablePath(moduleRoot, filePath)
    let parsed
    try {
      parsed = matter(await readFile(filePath, 'utf8'))
    } catch (error) {
      issues.push({ file: relativePath, message: `Invalid front matter: ${(error as Error).message}` })
      continue
    }
    const data = parsed.data
    if (!isNonEmptyString(data.name)) {
      issues.push({ file: relativePath, message: 'Must contain a non-empty name.' })
    }
    if (!isNonEmptyString(data.slug)) {
      issues.push({ file: relativePath, message: 'Must contain a non-empty slug.' })
    }
    validateSlugFormat(relativePath, data.slug, issues)
    const rank = numericOrUndefined(data.rank)
    if (rank === undefined) {
      issues.push({ file: relativePath, message: 'Must contain a numeric rank.' })
    }
    validateParentShape(relativePath, data, issues)
    if (data.id !== undefined && !isUuid(data.id)) {
      issues.push({ file: relativePath, message: 'id must be a valid UUID when provided.' })
    }
    if (!isNonEmptyString(data.slug) || rank === undefined) {
      continue
    }
    entries.push({
      kind: 'page',
      relativePath,
      slug: data.slug.trim(),
      rank,
      parentSlug: isNonEmptyString(data.parent) ? data.parent.trim() : undefined,
      explicitId: isUuid(data.id) ? data.id : undefined,
      record: {
        name: data.name,
        content: markdown.render(parsed.content).trimEnd(),
      },
    })
  }

  return entries
}

async function readGroups(moduleRoot: string, issues: BuildIssue[]): Promise<ResolvedEntry[]> {
  const entries: ResolvedEntry[] = []

  for (const filePath of await listFilesRecursively(join(moduleRoot, 'groups'), '.json')) {
    const relativePath = toPortablePath(moduleRoot, filePath)
    let data: Record<string, unknown>
    try {
      data = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    } catch (error) {
      issues.push({ file: relativePath, message: `Invalid JSON: ${(error as Error).message}` })
      continue
    }
    if (!isNonEmptyString(data.name)) {
      issues.push({ file: relativePath, message: 'Must contain a non-empty name.' })
    }
    if (!isNonEmptyString(data.slug)) {
      issues.push({ file: relativePath, message: 'Must contain a non-empty slug.' })
    }
    validateSlugFormat(relativePath, data.slug, issues)
    const rank = numericOrUndefined(data.rank)
    if (rank === undefined) {
      issues.push({ file: relativePath, message: 'Must contain a numeric rank.' })
    }
    validateParentShape(relativePath, data, issues)
    if (data.id !== undefined && !isUuid(data.id)) {
      issues.push({ file: relativePath, message: 'id must be a valid UUID when provided.' })
    }
    if (!isNonEmptyString(data.slug) || rank === undefined) {
      continue
    }
    entries.push({
      kind: 'group',
      relativePath,
      slug: data.slug.trim(),
      rank,
      parentSlug: isNonEmptyString(data.parent) ? data.parent.trim() : undefined,
      explicitId: isUuid(data.id) ? data.id : undefined,
      record: { name: data.name },
    })
  }

  return entries
}

function isResourceNameReserved(name: string): boolean {
  return (
    RESERVED_RESOURCE_NAMES.has(name) || RESERVED_RESOURCE_PREFIXES.some((prefix) => name.startsWith(prefix))
  )
}

/** Reads maps/**\/*.json (or encounters/**\/*.json), each of which references
 * a real EncounterPlus export archive via its "path" field. Merges every
 * export's resources into `resourcesOut`, keyed by their exact name inside
 * the archive, detecting collisions against each other and the module's
 * reserved file/folder names. */
async function readMapOrEncounterEntries(
  moduleRoot: string,
  kind: 'map' | 'encounter',
  issues: BuildIssue[],
  resourcesOut: Map<string, { data: Buffer; sourceName: string }>,
): Promise<ResolvedEntry[]> {
  const folder = kind === 'map' ? 'maps' : 'encounters'
  const manifestFileName = kind === 'map' ? 'maps.json' : 'encounters.json'
  const entries: ResolvedEntry[] = []

  for (const filePath of await listFilesRecursively(join(moduleRoot, folder), '.json')) {
    const relativePath = toPortablePath(moduleRoot, filePath)
    let localData: Record<string, unknown>
    try {
      localData = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    } catch (error) {
      issues.push({ file: relativePath, message: `Invalid JSON: ${(error as Error).message}` })
      continue
    }
    validateParentShape(relativePath, localData, issues)

    if (!isNonEmptyString(localData.path)) {
      issues.push({ file: relativePath, message: 'Must contain a non-empty path.' })
      continue
    }

    let resolvedArchivePath: string
    try {
      resolvedArchivePath = resolveProjectFile(moduleRoot, localData.path)
    } catch (error) {
      issues.push({ file: relativePath, message: (error as Error).message })
      continue
    }

    let exported
    try {
      exported = await readExportArchive(resolvedArchivePath, manifestFileName)
    } catch (error) {
      issues.push({ file: relativePath, message: (error as Error).message })
      continue
    }

    if (kind === 'map') {
      for (const field of ['image', 'floor']) {
        const requiredResource = exported.record[field]
        if (isNonEmptyString(requiredResource) && !exported.resources.has(requiredResource)) {
          issues.push({
            file: relativePath,
            message: `references missing map resource "${requiredResource}".`,
          })
        }
      }
    }

    const slug = isNonEmptyString(localData.slug)
      ? localData.slug.trim()
      : isNonEmptyString(exported.record.slug)
        ? exported.record.slug.trim()
        : undefined
    if (!slug) {
      issues.push({ file: relativePath, message: 'Must contain a non-empty slug.' })
      continue
    }
    validateSlugFormat(relativePath, slug, issues)
    const rank = numericOrUndefined(localData.rank) ?? numericOrUndefined(exported.record.rank)
    if (rank === undefined) {
      issues.push({ file: relativePath, message: 'Must contain a numeric rank.' })
      continue
    }

    for (const [resourceName, data] of exported.resources) {
      const existing = resourcesOut.get(resourceName)
      if (existing) {
        issues.push({
          file: relativePath,
          message: `Export resource collision for "${resourceName}" between ${existing.sourceName} and "${localData.path}".`,
        })
        continue
      }
      if (isResourceNameReserved(resourceName)) {
        issues.push({
          file: relativePath,
          message: `Export resource "${resourceName}" conflicts with another module resource.`,
        })
        continue
      }
      resourcesOut.set(resourceName, { data, sourceName: String(localData.path) })
    }

    entries.push({
      kind,
      relativePath,
      slug,
      rank,
      parentSlug: isNonEmptyString(localData.parent) ? localData.parent.trim() : undefined,
      // Map/encounter ids are always recomputed from the slug — an id inside
      // the export archive (or the local reference) is never trusted.
      explicitId: undefined,
      record: {
        ...exported.record,
        name: isNonEmptyString(localData.name) ? localData.name : exported.record.name,
        descr: typeof localData.descr === 'string' ? localData.descr : exported.record.descr,
      },
    })
  }

  return entries
}

/** Resolves parents across all entries at once: unlike the (lenient) Module
 * Explorer view, a build fails outright on an unknown parent slug, a
 * duplicate slug, a map/encounter used as a parent, or a parent cycle. */
function resolveStrictParents(
  entries: ResolvedEntry[],
  issues: BuildIssue[],
): Map<ResolvedEntry, ResolvedEntry | undefined> {
  const bySlug = new Map<string, ResolvedEntry[]>()
  for (const entry of entries) {
    const matches = bySlug.get(entry.slug) ?? []
    matches.push(entry)
    bySlug.set(entry.slug, matches)
  }
  for (const [slug, matches] of bySlug) {
    if (matches.length > 1) {
      const [first, second] = matches
      issues.push({
        file: first.relativePath,
        message: `Duplicate page, group, map, or encounter slug "${slug}" in ${first.relativePath} and ${second.relativePath}.`,
      })
    }
  }

  const parentOf = new Map<ResolvedEntry, ResolvedEntry | undefined>()
  for (const entry of entries) {
    if (!entry.parentSlug) {
      parentOf.set(entry, undefined)
      continue
    }
    const matches = bySlug.get(entry.parentSlug)
    if (!matches || matches.length === 0) {
      issues.push({
        file: entry.relativePath,
        message: `references an unknown parent slug "${entry.parentSlug}".`,
      })
      parentOf.set(entry, undefined)
      continue
    }
    const parent = matches[0]
    if (parent === entry) {
      issues.push({ file: entry.relativePath, message: 'cannot use its own slug as parent.' })
      parentOf.set(entry, undefined)
      continue
    }
    if (parent.kind === 'map' || parent.kind === 'encounter') {
      issues.push({
        file: entry.relativePath,
        message: `references "${entry.parentSlug}" as parent, but maps and encounters cannot be parents.`,
      })
      parentOf.set(entry, undefined)
      continue
    }
    parentOf.set(entry, parent)
  }

  const cycleBroken = new Set<ResolvedEntry>()
  function detectCycle(entry: ResolvedEntry, chain: ResolvedEntry[]): void {
    const cycleStart = chain.indexOf(entry)
    if (cycleStart !== -1) {
      if (!cycleBroken.has(entry)) {
        cycleBroken.add(entry)
        const chainDescription = [...chain.slice(cycleStart), entry].map((node) => node.slug).join(' -> ')
        issues.push({ file: entry.relativePath, message: `parent cycle detected: ${chainDescription}.` })
      }
      parentOf.set(entry, undefined)
      return
    }
    const parent = parentOf.get(entry)
    if (parent) {
      detectCycle(parent, [...chain, entry])
    }
  }
  for (const entry of entries) {
    detectCycle(entry, [])
  }

  return parentOf
}

async function addDirectoryToZip(zip: ZipFile, sourceDir: string, zipFolder: string): Promise<void> {
  for (const filePath of await listFilesRecursively(sourceDir)) {
    zip.addFile(filePath, `${zipFolder}/${toPortablePath(sourceDir, filePath)}`, { compress: false })
  }
}

export interface BuildOptions {
  /** Bumps module.json's patch version after a successful build, so the next
   * build starts from a new value — the .module just produced always keeps
   * the version it was built with. */
  autoIncrementVersion?: boolean
}

export async function buildModule(moduleRoot: string, options: BuildOptions = {}): Promise<BuildSummary> {
  const issues: BuildIssue[] = []

  const moduleJson = await readModuleJson(moduleRoot, issues)
  if (!moduleJson) {
    throw new ModuleBuildError(issues)
  }
  if (moduleJson.id === undefined) {
    moduleJson.id = randomUUID()
    await writeFile(join(moduleRoot, 'module.json'), `${JSON.stringify(moduleJson, null, 2)}\n`, 'utf8')
  }
  await validateModuleJson(moduleRoot, moduleJson, issues)

  const exportedResources = new Map<string, { data: Buffer; sourceName: string }>()
  const [pages, groups, maps, encounters] = await Promise.all([
    readPages(moduleRoot, issues),
    readGroups(moduleRoot, issues),
    readMapOrEncounterEntries(moduleRoot, 'map', issues, exportedResources),
    readMapOrEncounterEntries(moduleRoot, 'encounter', issues, exportedResources),
  ])
  const entries = [...pages, ...groups, ...maps, ...encounters]

  if (issues.length > 0) {
    throw new ModuleBuildError(issues)
  }

  const moduleId = moduleJson.id as string
  const parentOf = resolveStrictParents(entries, issues)
  if (issues.length > 0) {
    throw new ModuleBuildError(issues)
  }

  const idOf = new Map<ResolvedEntry, string>()
  for (const entry of entries) {
    idOf.set(entry, entry.explicitId ?? createUuidV5(entry.slug, moduleId))
  }
  const parentIdOf = (entry: ResolvedEntry): string => {
    const parent = parentOf.get(entry)
    return parent ? (idOf.get(parent) ?? '') : ''
  }
  const compareEntries = (a: ResolvedEntry, b: ResolvedEntry): number => a.rank - b.rank || a.slug.localeCompare(b.slug)

  function finalRecords(kind: EntryKind): Record<string, unknown>[] {
    return entries
      .filter((entry) => entry.kind === kind)
      .sort(compareEntries)
      .map((entry) => ({
        ...entry.record,
        id: idOf.get(entry),
        slug: entry.slug,
        rank: entry.rank,
        parentId: parentIdOf(entry),
      }))
  }
  const pageRecords = finalRecords('page')
  const groupRecords = finalRecords('group')
  const mapRecords = finalRecords('map')
  const encounterRecords = finalRecords('encounter')

  const outputPath = join(moduleRoot, `${basename(moduleRoot)}.module`)

  // EncounterPlus expects an uncompressed (stored) zip archive.
  const zip = new ZipFile()
  const addJson = (data: unknown, archivePath: string): void => {
    zip.addBuffer(Buffer.from(JSON.stringify(data)), archivePath, { compress: false })
  }
  zip.addBuffer(
    Buffer.from(`${JSON.stringify(stripEmptyOptionalFields(moduleJson), null, 2)}\n`),
    'module.json',
    { compress: false },
  )
  addJson(pageRecords, 'pages.json')
  addJson(groupRecords, 'groups.json')
  addJson(mapRecords, 'maps.json')
  addJson(encounterRecords, 'encounters.json')

  await addDirectoryToZip(zip, join(moduleRoot, 'images'), 'images')
  await addDirectoryToZip(zip, join(moduleRoot, 'assets'), 'assets')

  // Map/encounter export resources are merged flat at the archive root —
  // EncounterPlus never sees the original export zips, only their contents.
  for (const [resourceName, resource] of exportedResources) {
    zip.addBuffer(resource.data, resourceName, { compress: false })
  }

  for (const field of ['image', 'banner']) {
    const resourcePath = moduleJson[field]
    if (isNonEmptyString(resourcePath)) {
      zip.addFile(join(moduleRoot, resourcePath), resourcePath, { compress: false })
    }
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    zip.outputStream.pipe(createWriteStream(outputPath)).on('close', () => resolvePromise()).on('error', rejectPromise)
    zip.end()
  })

  const builtVersion = moduleJson.version as string
  let nextVersion: string | undefined
  if (options.autoIncrementVersion && isNonEmptyString(moduleJson.version)) {
    nextVersion = incrementPatchVersion(moduleJson.version)
    if (nextVersion !== moduleJson.version) {
      moduleJson.version = nextVersion
      await writeFile(join(moduleRoot, 'module.json'), `${JSON.stringify(moduleJson, null, 2)}\n`, 'utf8')
    } else {
      nextVersion = undefined
    }
  }

  return {
    outputPath,
    pageCount: pageRecords.length,
    groupCount: groupRecords.length,
    mapCount: mapRecords.length,
    encounterCount: encounterRecords.length,
    builtVersion,
    nextVersion,
  }
}
