import { createWriteStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import matter from 'gray-matter'
import { ZipFile } from 'yazl'
import { listFilesRecursively } from './fileScan.js'
import { readExportArchive } from './mapEncounterExport.js'
import { createMarkdownRenderer } from './markdownRenderer.js'
import type { MpxMarkdownEnvironment } from './markdownRenderer.js'
import { MODULE_CATEGORIES } from './moduleProject.js'
import { isValidSlug, slugify } from './slug.js'
import { incrementPatchVersion } from './version.js'
import { resolveProjectFile } from './projectPath.js'
import { createUuidV5, isUuid } from './uuid.js'
import { COMPENDIUM_RULESET } from './compendiumEntries.js'
import type { MeasurementSystem, ContentLanguage } from './localization.js'
import type { CatalogOverrides } from './catalog.js'
import { isNonEmptyString, isPlainObject, stripEmptyValues } from './compendiumShared.js'
import { SPELL_IMAGE_PATTERN, validateSpellData, stripEmptySpellFields } from './spellCompendium.js'
import { ITEM_IMAGE_PATTERN, validateItemData, stripEmptyItemFields } from './itemCompendium.js'
import { MONSTER_IMAGE_PATTERN, validateMonsterData, stripEmptyMonsterFields } from './monsterCompendium.js'
import { BACKGROUND_IMAGE_PATTERN, validateBackgroundData, stripEmptyBackgroundFields } from './backgroundCompendium.js'
import { INLINE_IMAGE_PATTERN, inlineImageBasename } from './compendiumBlock.js'
import type { SpellDisplayDefaults } from './spellBlock.js'
import type { ItemDisplayDefaults } from './itemBlock.js'
import type { MonsterDisplayDefaults } from './monsterBlock.js'
import type { BackgroundDisplayDefaults } from './backgroundBlock.js'

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
  itemCount: number
  spellCount: number
  tableCount: number
  monsterCount: number
  backgroundCount: number
  /** The version the .module archive was actually built with. */
  builtVersion: string
  /** Set only when autoIncrementVersion bumped module.json for the next build. */
  nextVersion?: string
  /** Internal links that don't resolve to any real page/group/map/encounter
   * slug or, for a `#anchor` link, any heading on the same page — a
   * non-blocking signal (unlike `issues`/ModuleBuildError), since a broken
   * link doesn't stop EncounterPlus from importing the module. Always
   * present, empty when nothing was found. */
  brokenLinks: BuildIssue[]
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
  'backgrounds.json',
])
const RESERVED_RESOURCE_PREFIXES = ['images/', 'assets/', 'items/', 'spells/', 'monsters/', 'backgrounds/']

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
  return stripEmptyValues(moduleJson, MODULE_JSON_OPTIONAL_FIELDS)
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

/** An inline ````spell`/````item` block found while rendering a page,
 * carrying the page it was found in so a build-time issue can point back
 * to it. */
interface PageInlineEntrySource {
  pageRelativePath: string
  data: Record<string, unknown>
}

async function readPages(
  moduleRoot: string,
  issues: BuildIssue[],
  measurement: MeasurementSystem,
  contentLanguage: ContentLanguage,
  catalogOverrides: CatalogOverrides | undefined,
  spellDisplayDefaults: SpellDisplayDefaults | undefined,
  itemDisplayDefaults: ItemDisplayDefaults | undefined,
  monsterDisplayDefaults: MonsterDisplayDefaults | undefined,
  backgroundDisplayDefaults: BackgroundDisplayDefaults | undefined,
  autoDetectRollTables: boolean,
): Promise<{
  entries: ResolvedEntry[]
  inlineSpells: PageInlineEntrySource[]
  inlineItems: PageInlineEntrySource[]
  inlineMonsters: PageInlineEntrySource[]
  inlineBackgrounds: PageInlineEntrySource[]
  inlineRollTables: PageInlineEntrySource[]
}> {
  const markdown = createMarkdownRenderer({
    measurement,
    language: contentLanguage,
    overrides: catalogOverrides,
    spellDisplayDefaults,
    itemDisplayDefaults,
    monsterDisplayDefaults,
    backgroundDisplayDefaults,
    autoDetectRollTables,
  })
  const entries: ResolvedEntry[] = []
  const inlineSpells: PageInlineEntrySource[] = []
  const inlineItems: PageInlineEntrySource[] = []
  const inlineMonsters: PageInlineEntrySource[] = []
  const inlineBackgrounds: PageInlineEntrySource[] = []
  const inlineRollTables: PageInlineEntrySource[] = []

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

    const env: MpxMarkdownEnvironment = { pageName: data.name, pageSlug: data.slug.trim() }
    const content = markdown.render(parsed.content, env).trimEnd()
    for (const block of env.inlineSpells ?? []) {
      inlineSpells.push({ pageRelativePath: relativePath, data: block.data })
    }
    for (const block of env.inlineItems ?? []) {
      inlineItems.push({ pageRelativePath: relativePath, data: block.data })
    }
    for (const block of env.inlineMonsters ?? []) {
      inlineMonsters.push({ pageRelativePath: relativePath, data: block.data })
    }
    for (const block of env.inlineBackgrounds ?? []) {
      inlineBackgrounds.push({ pageRelativePath: relativePath, data: block.data })
    }
    for (const block of env.inlineRollTables ?? []) {
      inlineRollTables.push({ pageRelativePath: relativePath, data: block.data })
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
        content,
      },
    })
  }

  return { entries, inlineSpells, inlineItems, inlineMonsters, inlineBackgrounds, inlineRollTables }
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

interface CompendiumEntryOptions {
  folder: string
  kind: string
  imagePattern: RegExp
  validateData: (relativePath: string, data: unknown, issues: BuildIssue[]) => void
  stripEmptyFields: (record: Record<string, unknown>) => Record<string, unknown>
  /** A second image-like field (e.g. monster "token"), validated/copied the
   * same way as "image". */
  secondaryImageField?: string
  /** Fills `attributes.measurement`/`attributes.ruleset` when the file
   * leaves them empty/absent — an explicit value in the file always wins. */
  defaultMeasurement: MeasurementSystem
}

/** An explicit, non-empty value in the file always wins over the project
 * default — matching how EncounterPlus treats this as a genuinely
 * per-entity field (real exports show different items with different
 * rulesets), not a project-wide constant to enforce. */
function applyCompendiumAttributeDefaults(record: Record<string, unknown>, defaultMeasurement: MeasurementSystem): void {
  const attributes = isPlainObject(record.attributes) ? { ...record.attributes } : {}
  if (!isNonEmptyString(attributes.measurement)) {
    attributes.measurement = defaultMeasurement
  }
  if (!isNonEmptyString(attributes.ruleset)) {
    attributes.ruleset = COMPENDIUM_RULESET
  }
  record.attributes = attributes
}

/** Reads <folder>/**\/*.json (items, spells, ...). Unlike pages/groups/maps/
 * encounters, these carry no rank/parent — they're flat compendium content,
 * each requiring its own explicit, permanent UUID (never recomputed from the
 * slug). */
async function readCompendiumEntries(
  moduleRoot: string,
  options: CompendiumEntryOptions,
  issues: BuildIssue[],
  imageResourcesOut: Map<string, string>,
): Promise<Record<string, unknown>[]> {
  const { folder, kind, imagePattern, validateData, stripEmptyFields, secondaryImageField, defaultMeasurement } =
    options
  const entries: Record<string, unknown>[] = []
  const pathById = new Map<string, string>()
  const pathBySlug = new Map<string, string>()

  for (const filePath of await listFilesRecursively(join(moduleRoot, folder), '.json')) {
    const relativePath = toPortablePath(moduleRoot, filePath)
    let data: Record<string, unknown>
    try {
      data = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    } catch (error) {
      issues.push({ file: relativePath, message: `Invalid JSON: ${(error as Error).message}` })
      continue
    }

    if (!isUuid(data.id)) {
      issues.push({ file: relativePath, message: 'Must contain a valid UUID id.' })
    }
    if (!isNonEmptyString(data.name)) {
      issues.push({ file: relativePath, message: 'Must contain a non-empty name.' })
    }
    if (!isNonEmptyString(data.slug)) {
      issues.push({ file: relativePath, message: 'Must contain a non-empty slug.' })
    }
    validateSlugFormat(relativePath, data.slug, issues)
    if (data.attributes !== undefined && !isPlainObject(data.attributes)) {
      issues.push({ file: relativePath, message: 'attributes must be an object when provided.' })
    }
    validateData(relativePath, data.data, issues)
    if (data.sources !== undefined && !Array.isArray(data.sources)) {
      issues.push({ file: relativePath, message: 'sources must be an array when provided.' })
    }
    if (data.tags !== undefined && (!Array.isArray(data.tags) || !data.tags.every((tag) => typeof tag === 'string'))) {
      issues.push({ file: relativePath, message: 'tags must be an array of strings when provided.' })
    }
    for (const imageField of ['image', ...(secondaryImageField ? [secondaryImageField] : [])]) {
      const imageValue = data[imageField]
      if (!isNonEmptyString(imageValue) || imageValue === `${folder}/`) {
        continue
      }
      if (!imagePattern.test(imageValue)) {
        issues.push({
          file: relativePath,
          message: `${imageField} must be a path to a file directly inside the ${folder} folder.`,
        })
      } else {
        const resolved = await checkResourceReference(moduleRoot, relativePath, `"${imageField}"`, imageValue, issues)
        if (resolved) {
          imageResourcesOut.set(imageValue, resolved)
        }
      }
    }

    if (!isUuid(data.id) || !isNonEmptyString(data.slug)) {
      continue
    }
    const slug = data.slug.trim()
    const id = data.id

    const existingIdPath = pathById.get(id)
    if (existingIdPath) {
      issues.push({ file: relativePath, message: `Duplicate ${kind} id "${id}" in ${existingIdPath} and ${relativePath}.` })
    } else {
      pathById.set(id, relativePath)
    }
    const existingSlugPath = pathBySlug.get(slug)
    if (existingSlugPath) {
      issues.push({ file: relativePath, message: `Duplicate ${kind} slug "${slug}" in ${existingSlugPath} and ${relativePath}.` })
    } else {
      pathBySlug.set(slug, relativePath)
    }

    const record = { ...data, slug }
    applyCompendiumAttributeDefaults(record, defaultMeasurement)
    entries.push(stripEmptyFields(record))
  }

  return entries.sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

function readItems(
  moduleRoot: string,
  issues: BuildIssue[],
  imageResourcesOut: Map<string, string>,
  defaultMeasurement: MeasurementSystem,
): Promise<Record<string, unknown>[]> {
  return readCompendiumEntries(
    moduleRoot,
    {
      folder: 'items',
      kind: 'item',
      imagePattern: ITEM_IMAGE_PATTERN,
      validateData: validateItemData,
      stripEmptyFields: stripEmptyItemFields,
      defaultMeasurement,
    },
    issues,
    imageResourcesOut,
  )
}

function readSpells(
  moduleRoot: string,
  issues: BuildIssue[],
  imageResourcesOut: Map<string, string>,
  defaultMeasurement: MeasurementSystem,
): Promise<Record<string, unknown>[]> {
  return readCompendiumEntries(
    moduleRoot,
    {
      folder: 'spells',
      kind: 'spell',
      imagePattern: SPELL_IMAGE_PATTERN,
      validateData: validateSpellData,
      stripEmptyFields: stripEmptySpellFields,
      defaultMeasurement,
    },
    issues,
    imageResourcesOut,
  )
}

/** Resolves an inline block's `image`/`token` field for the build. The
 * page HTML (already rendered by readPages, since it's the same
 * renderer) shows the image unconditionally whenever it's set — that
 * needs no action here, since `images/` is copied into the zip verbatim
 * like any other page image (see addDirectoryToZip). This only handles
 * the *Compendium copy*: validates the file exists, and when
 * `addToCompendium` is true, additionally schedules it to be copied into
 * the entity's own folder (`items/`, `monsters/`, ...) and returns the
 * entity-folder path to store in the built record's own `image`/`token`
 * field — mirroring a standalone file's own convention, so the
 * Compendium's own detail view in EncounterPlus shows it too. Returns
 * undefined (field omitted from the record) whenever the source field is
 * empty, the placeholder, invalid, or `addToCompendium` is false. */
async function resolveInlineCompendiumImage(
  moduleRoot: string,
  label: string,
  fieldLabel: string,
  entityFolder: string,
  imageValue: unknown,
  addToCompendium: boolean,
  imageResourcesOut: Map<string, string>,
  issues: BuildIssue[],
): Promise<string | undefined> {
  if (!isNonEmptyString(imageValue) || imageValue === 'images/') {
    return undefined
  }
  if (!INLINE_IMAGE_PATTERN.test(imageValue)) {
    issues.push({ file: label, message: `${fieldLabel} must be a path to a file directly inside the images folder.` })
    return undefined
  }
  const resolved = await checkResourceReference(moduleRoot, label, fieldLabel, imageValue, issues)
  if (!resolved || !addToCompendium) {
    return undefined
  }
  const archivePath = `${entityFolder}/${inlineImageBasename(imageValue)}`
  imageResourcesOut.set(archivePath, resolved)
  return archivePath
}

const SPELL_ENVELOPE_FIELDS = ['name', 'attributes', 'descr', 'sources', 'tags', 'data'] as const

/** Normalizes one inline ````spell` block (already lightly validated at
 * preview-render time) into the same record shape a standalone spells/*.json
 * file produces, applying the full build-time validation/defaults/id
 * resolution — so both sources merge into spells.json indistinguishably.
 * `pathById`/`pathBySlug` are seeded with the standalone spells first, so a
 * collision against either source is caught the same way a collision between
 * two standalone files already is. */
async function buildInlineSpellRecord(
  moduleRoot: string,
  source: PageInlineEntrySource,
  moduleId: string,
  defaultMeasurement: MeasurementSystem,
  defaultAddImageToCompendium: boolean,
  issues: BuildIssue[],
  imageResourcesOut: Map<string, string>,
  pathById: Map<string, string>,
  pathBySlug: Map<string, string>,
): Promise<Record<string, unknown> | undefined> {
  const { pageRelativePath, data: raw } = source
  const name = raw.name as string
  const label = `${pageRelativePath} (inline spell "${name}")`

  const slug = isNonEmptyString(raw.slug) ? raw.slug.trim() : slugify(name)
  validateSlugFormat(label, slug, issues)
  validateSpellData(label, raw.data, issues)
  if (raw.sources !== undefined && !Array.isArray(raw.sources)) {
    issues.push({ file: label, message: 'sources must be an array when provided.' })
  }
  if (raw.tags !== undefined && (!Array.isArray(raw.tags) || !raw.tags.every((tag) => typeof tag === 'string'))) {
    issues.push({ file: label, message: 'tags must be an array of strings when provided.' })
  }
  const addImageToCompendium = typeof raw.addImageToCompendium === 'boolean' ? raw.addImageToCompendium : defaultAddImageToCompendium
  const compendiumImage = await resolveInlineCompendiumImage(
    moduleRoot,
    label,
    '"image"',
    'spells',
    raw.image,
    addImageToCompendium,
    imageResourcesOut,
    issues,
  )

  if (!isValidSlug(slug)) {
    return undefined
  }

  const explicitId = isUuid(raw.id) ? (raw.id as string) : undefined
  const id = explicitId ?? createUuidV5(slug, moduleId)

  const existingSlugPath = pathBySlug.get(slug)
  if (existingSlugPath) {
    issues.push({ file: label, message: `Duplicate spell slug "${slug}" in ${existingSlugPath} and ${label}.` })
  } else {
    pathBySlug.set(slug, label)
  }
  const existingIdPath = pathById.get(id)
  if (existingIdPath) {
    issues.push({ file: label, message: `Duplicate spell id "${id}" in ${existingIdPath} and ${label}.` })
  } else {
    pathById.set(id, label)
  }

  const record: Record<string, unknown> = { id, slug }
  for (const field of SPELL_ENVELOPE_FIELDS) {
    if (raw[field] !== undefined) {
      record[field] = raw[field]
    }
  }
  if (compendiumImage) {
    record.image = compendiumImage
  }
  applyCompendiumAttributeDefaults(record, defaultMeasurement)
  return stripEmptySpellFields(record)
}

const ITEM_ENVELOPE_FIELDS = ['name', 'attributes', 'descr', 'sources', 'tags', 'data'] as const

/** Same mechanism as buildInlineSpellRecord (see its comment) — for items
 * merging into items.json instead of spells.json. */
async function buildInlineItemRecord(
  moduleRoot: string,
  source: PageInlineEntrySource,
  moduleId: string,
  defaultMeasurement: MeasurementSystem,
  defaultAddImageToCompendium: boolean,
  issues: BuildIssue[],
  imageResourcesOut: Map<string, string>,
  pathById: Map<string, string>,
  pathBySlug: Map<string, string>,
): Promise<Record<string, unknown> | undefined> {
  const { pageRelativePath, data: raw } = source
  const name = raw.name as string
  const label = `${pageRelativePath} (inline item "${name}")`

  const slug = isNonEmptyString(raw.slug) ? raw.slug.trim() : slugify(name)
  validateSlugFormat(label, slug, issues)
  validateItemData(label, raw.data, issues)
  if (raw.sources !== undefined && !Array.isArray(raw.sources)) {
    issues.push({ file: label, message: 'sources must be an array when provided.' })
  }
  if (raw.tags !== undefined && (!Array.isArray(raw.tags) || !raw.tags.every((tag) => typeof tag === 'string'))) {
    issues.push({ file: label, message: 'tags must be an array of strings when provided.' })
  }
  const addImageToCompendium = typeof raw.addImageToCompendium === 'boolean' ? raw.addImageToCompendium : defaultAddImageToCompendium
  const compendiumImage = await resolveInlineCompendiumImage(
    moduleRoot,
    label,
    '"image"',
    'items',
    raw.image,
    addImageToCompendium,
    imageResourcesOut,
    issues,
  )

  if (!isValidSlug(slug)) {
    return undefined
  }

  const explicitId = isUuid(raw.id) ? (raw.id as string) : undefined
  const id = explicitId ?? createUuidV5(slug, moduleId)

  const existingSlugPath = pathBySlug.get(slug)
  if (existingSlugPath) {
    issues.push({ file: label, message: `Duplicate item slug "${slug}" in ${existingSlugPath} and ${label}.` })
  } else {
    pathBySlug.set(slug, label)
  }
  const existingIdPath = pathById.get(id)
  if (existingIdPath) {
    issues.push({ file: label, message: `Duplicate item id "${id}" in ${existingIdPath} and ${label}.` })
  } else {
    pathById.set(id, label)
  }

  const record: Record<string, unknown> = { id, slug }
  for (const field of ITEM_ENVELOPE_FIELDS) {
    if (raw[field] !== undefined) {
      record[field] = raw[field]
    }
  }
  if (compendiumImage) {
    record.image = compendiumImage
  }
  applyCompendiumAttributeDefaults(record, defaultMeasurement)
  return stripEmptyItemFields(record)
}

const MONSTER_ENVELOPE_FIELDS = ['name', 'attributes', 'descr', 'sources', 'tags', 'data'] as const

/** Same mechanism as buildInlineSpellRecord (see its comment) — for
 * monsters merging into monsters.json instead of spells.json. `token` is
 * validated the same way as `image` (both live in the monsters/ folder) —
 * `color`/`twoColumn` are inline-authoring-only presentation fields, not
 * part of MONSTER_ENVELOPE_FIELDS, so they're dropped here same as a
 * spell/item's `show*` fields never reaching the built JSON. */
async function buildInlineMonsterRecord(
  moduleRoot: string,
  source: PageInlineEntrySource,
  moduleId: string,
  defaultMeasurement: MeasurementSystem,
  defaultAddImageToCompendium: boolean,
  defaultAddTokenToCompendium: boolean,
  issues: BuildIssue[],
  imageResourcesOut: Map<string, string>,
  pathById: Map<string, string>,
  pathBySlug: Map<string, string>,
): Promise<Record<string, unknown> | undefined> {
  const { pageRelativePath, data: raw } = source
  const name = raw.name as string
  const label = `${pageRelativePath} (inline monster "${name}")`

  const slug = isNonEmptyString(raw.slug) ? raw.slug.trim() : slugify(name)
  validateSlugFormat(label, slug, issues)
  validateMonsterData(label, raw.data, issues)
  if (raw.sources !== undefined && !Array.isArray(raw.sources)) {
    issues.push({ file: label, message: 'sources must be an array when provided.' })
  }
  if (raw.tags !== undefined && (!Array.isArray(raw.tags) || !raw.tags.every((tag) => typeof tag === 'string'))) {
    issues.push({ file: label, message: 'tags must be an array of strings when provided.' })
  }
  const addImageToCompendium = typeof raw.addImageToCompendium === 'boolean' ? raw.addImageToCompendium : defaultAddImageToCompendium
  const compendiumImage = await resolveInlineCompendiumImage(
    moduleRoot,
    label,
    '"image"',
    'monsters',
    raw.image,
    addImageToCompendium,
    imageResourcesOut,
    issues,
  )
  const addTokenToCompendium = typeof raw.addTokenToCompendium === 'boolean' ? raw.addTokenToCompendium : defaultAddTokenToCompendium
  const compendiumToken = await resolveInlineCompendiumImage(
    moduleRoot,
    label,
    '"token"',
    'monsters',
    raw.token,
    addTokenToCompendium,
    imageResourcesOut,
    issues,
  )

  if (!isValidSlug(slug)) {
    return undefined
  }

  const explicitId = isUuid(raw.id) ? (raw.id as string) : undefined
  const id = explicitId ?? createUuidV5(slug, moduleId)

  const existingSlugPath = pathBySlug.get(slug)
  if (existingSlugPath) {
    issues.push({ file: label, message: `Duplicate monster slug "${slug}" in ${existingSlugPath} and ${label}.` })
  } else {
    pathBySlug.set(slug, label)
  }
  const existingIdPath = pathById.get(id)
  if (existingIdPath) {
    issues.push({ file: label, message: `Duplicate monster id "${id}" in ${existingIdPath} and ${label}.` })
  } else {
    pathById.set(id, label)
  }

  const record: Record<string, unknown> = { id, slug }
  for (const field of MONSTER_ENVELOPE_FIELDS) {
    if (raw[field] !== undefined) {
      record[field] = raw[field]
    }
  }
  if (compendiumImage) {
    record.image = compendiumImage
  }
  if (compendiumToken) {
    record.token = compendiumToken
  }
  applyCompendiumAttributeDefaults(record, defaultMeasurement)
  return stripEmptyMonsterFields(record)
}

function readMonsters(
  moduleRoot: string,
  issues: BuildIssue[],
  imageResourcesOut: Map<string, string>,
  defaultMeasurement: MeasurementSystem,
): Promise<Record<string, unknown>[]> {
  return readCompendiumEntries(
    moduleRoot,
    {
      folder: 'monsters',
      kind: 'monster',
      imagePattern: MONSTER_IMAGE_PATTERN,
      validateData: validateMonsterData,
      stripEmptyFields: stripEmptyMonsterFields,
      secondaryImageField: 'token',
      defaultMeasurement,
    },
    issues,
    imageResourcesOut,
  )
}

function readBackgrounds(
  moduleRoot: string,
  issues: BuildIssue[],
  imageResourcesOut: Map<string, string>,
  defaultMeasurement: MeasurementSystem,
): Promise<Record<string, unknown>[]> {
  return readCompendiumEntries(
    moduleRoot,
    {
      folder: 'backgrounds',
      kind: 'background',
      imagePattern: BACKGROUND_IMAGE_PATTERN,
      validateData: validateBackgroundData,
      stripEmptyFields: stripEmptyBackgroundFields,
      defaultMeasurement,
    },
    issues,
    imageResourcesOut,
  )
}

const BACKGROUND_ENVELOPE_FIELDS = ['name', 'attributes', 'descr', 'sources', 'tags', 'data'] as const

/** Same mechanism as buildInlineItemRecord (see its comment) — for
 * backgrounds merging into backgrounds.json instead of items.json. */
async function buildInlineBackgroundRecord(
  moduleRoot: string,
  source: PageInlineEntrySource,
  moduleId: string,
  defaultMeasurement: MeasurementSystem,
  defaultAddImageToCompendium: boolean,
  issues: BuildIssue[],
  imageResourcesOut: Map<string, string>,
  pathById: Map<string, string>,
  pathBySlug: Map<string, string>,
): Promise<Record<string, unknown> | undefined> {
  const { pageRelativePath, data: raw } = source
  const name = raw.name as string
  const label = `${pageRelativePath} (inline background "${name}")`

  const slug = isNonEmptyString(raw.slug) ? raw.slug.trim() : slugify(name)
  validateSlugFormat(label, slug, issues)
  validateBackgroundData(label, raw.data, issues)
  if (raw.sources !== undefined && !Array.isArray(raw.sources)) {
    issues.push({ file: label, message: 'sources must be an array when provided.' })
  }
  if (raw.tags !== undefined && (!Array.isArray(raw.tags) || !raw.tags.every((tag) => typeof tag === 'string'))) {
    issues.push({ file: label, message: 'tags must be an array of strings when provided.' })
  }
  const addImageToCompendium = typeof raw.addImageToCompendium === 'boolean' ? raw.addImageToCompendium : defaultAddImageToCompendium
  const compendiumImage = await resolveInlineCompendiumImage(
    moduleRoot,
    label,
    '"image"',
    'backgrounds',
    raw.image,
    addImageToCompendium,
    imageResourcesOut,
    issues,
  )

  if (!isValidSlug(slug)) {
    return undefined
  }

  const explicitId = isUuid(raw.id) ? (raw.id as string) : undefined
  const id = explicitId ?? createUuidV5(slug, moduleId)

  const existingSlugPath = pathBySlug.get(slug)
  if (existingSlugPath) {
    issues.push({ file: label, message: `Duplicate background slug "${slug}" in ${existingSlugPath} and ${label}.` })
  } else {
    pathBySlug.set(slug, label)
  }
  const existingIdPath = pathById.get(id)
  if (existingIdPath) {
    issues.push({ file: label, message: `Duplicate background id "${id}" in ${existingIdPath} and ${label}.` })
  } else {
    pathById.set(id, label)
  }

  const record: Record<string, unknown> = { id, slug }
  for (const field of BACKGROUND_ENVELOPE_FIELDS) {
    if (raw[field] !== undefined) {
      record[field] = raw[field]
    }
  }
  if (compendiumImage) {
    record.image = compendiumImage
  }
  applyCompendiumAttributeDefaults(record, defaultMeasurement)
  return stripEmptyBackgroundFields(record)
}

const ROLL_TABLE_ROLL_MODES = ['normal', 'noRepeat', 'eachRow']
const ROLL_TABLE_OPTIONAL_FIELDS = ['descr', 'sources', 'tags']

/** Shared by readRollTables (standalone tables/*.json) and
 * buildInlineRollTableRecord (auto-detected from a page's Markdown table) —
 * same columns/rows/rollMode/sources/tags shape either way. */
function validateRollTableShape(relativePath: string, data: Record<string, unknown>, issues: BuildIssue[]): void {
  const columnCount = Array.isArray(data.columns) ? data.columns.length : undefined
  if (
    !Array.isArray(data.columns) ||
    data.columns.length < 2 ||
    data.columns.some((column) => !isPlainObject(column) || !isNonEmptyString(column.name))
  ) {
    issues.push({
      file: relativePath,
      message: 'columns must contain at least two entries, each with a non-empty name.',
    })
  }
  if (
    !Array.isArray(data.rows) ||
    data.rows.some(
      (row) => !Array.isArray(row) || row.length !== columnCount || row.some((cell) => typeof cell !== 'string'),
    )
  ) {
    issues.push({ file: relativePath, message: 'rows must be arrays of strings matching the number of columns.' })
  }
  if (data.rollMode !== undefined && !ROLL_TABLE_ROLL_MODES.includes(data.rollMode as string)) {
    issues.push({
      file: relativePath,
      message: `rollMode must be one of ${ROLL_TABLE_ROLL_MODES.map((mode) => `"${mode}"`).join(', ')}.`,
    })
  }
  if (data.sources !== undefined && !Array.isArray(data.sources)) {
    issues.push({ file: relativePath, message: 'sources must be an array when provided.' })
  }
  if (data.tags !== undefined && (!Array.isArray(data.tags) || !data.tags.every((tag) => typeof tag === 'string'))) {
    issues.push({ file: relativePath, message: 'tags must be an array of strings when provided.' })
  }
}

/** Reads tables/**\/*.json. Unlike items/spells, roll tables have no
 * attributes/data/image envelope — just columns/rows and a few optional
 * fields. `rolls` is an EncounterPlus-internal runtime field (roll history)
 * that we never author and always drop, matching what a real compiled
 * tables.json never carries from an externally-authored file either. */
async function readRollTables(moduleRoot: string, issues: BuildIssue[]): Promise<Record<string, unknown>[]> {
  const tables: Record<string, unknown>[] = []
  const pathById = new Map<string, string>()
  const pathBySlug = new Map<string, string>()

  for (const filePath of await listFilesRecursively(join(moduleRoot, 'tables'), '.json')) {
    const relativePath = toPortablePath(moduleRoot, filePath)
    let data: Record<string, unknown>
    try {
      data = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    } catch (error) {
      issues.push({ file: relativePath, message: `Invalid JSON: ${(error as Error).message}` })
      continue
    }

    if (!isUuid(data.id)) {
      issues.push({ file: relativePath, message: 'Must contain a valid UUID id.' })
    }
    if (!isNonEmptyString(data.name)) {
      issues.push({ file: relativePath, message: 'Must contain a non-empty name.' })
    }
    if (!isNonEmptyString(data.slug)) {
      issues.push({ file: relativePath, message: 'Must contain a non-empty slug.' })
    }
    validateSlugFormat(relativePath, data.slug, issues)
    validateRollTableShape(relativePath, data, issues)

    if (!isUuid(data.id) || !isNonEmptyString(data.slug)) {
      continue
    }
    const slug = data.slug.trim()
    const id = data.id

    const existingIdPath = pathById.get(id)
    if (existingIdPath) {
      issues.push({
        file: relativePath,
        message: `Duplicate roll table id "${id}" in ${existingIdPath} and ${relativePath}.`,
      })
    } else {
      pathById.set(id, relativePath)
    }
    const existingSlugPath = pathBySlug.get(slug)
    if (existingSlugPath) {
      issues.push({
        file: relativePath,
        message: `Duplicate roll table slug "${slug}" in ${existingSlugPath} and ${relativePath}.`,
      })
    } else {
      pathBySlug.set(slug, relativePath)
    }

    const cleaned = stripEmptyValues({ ...data, slug }, ROLL_TABLE_OPTIONAL_FIELDS)
    delete cleaned.rolls
    if (cleaned.rollMode === 'normal') {
      delete cleaned.rollMode
    }
    tables.push(cleaned)
  }

  return tables.sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

/** Normalizes one roll table auto-detected from a page's Markdown table
 * (installRollTableDetection in markdownRenderer.ts) into the same record
 * shape a standalone tables/*.json file produces — same mechanism as
 * buildInlineSpellRecord, but simpler: no attributes/data/image envelope,
 * and the id is always derived (an inline table is never authored with an
 * explicit UUID, unlike a standalone file). `pathById`/`pathBySlug` are
 * seeded with the standalone tables first, so a collision against either
 * source is caught the same way a collision between two standalone files
 * already is. */
function buildInlineRollTableRecord(
  source: PageInlineEntrySource,
  moduleId: string,
  issues: BuildIssue[],
  pathById: Map<string, string>,
  pathBySlug: Map<string, string>,
): Record<string, unknown> | undefined {
  const { pageRelativePath, data: raw } = source
  const name = raw.name as string
  const label = `${pageRelativePath} (inline roll table "${name}")`

  const slug = isNonEmptyString(raw.slug) ? raw.slug.trim() : slugify(name)
  validateSlugFormat(label, slug, issues)
  validateRollTableShape(label, raw, issues)

  if (!isValidSlug(slug)) {
    return undefined
  }

  const id = createUuidV5(slug, moduleId)

  const existingSlugPath = pathBySlug.get(slug)
  if (existingSlugPath) {
    issues.push({ file: label, message: `Duplicate roll table slug "${slug}" in ${existingSlugPath} and ${label}.` })
  } else {
    pathBySlug.set(slug, label)
  }
  const existingIdPath = pathById.get(id)
  if (existingIdPath) {
    issues.push({ file: label, message: `Duplicate roll table id "${id}" in ${existingIdPath} and ${label}.` })
  } else {
    pathById.set(id, label)
  }

  const cleaned = stripEmptyValues({ ...raw, id, slug }, ROLL_TABLE_OPTIONAL_FIELDS)
  delete cleaned.rolls
  if (cleaned.rollMode === 'normal') {
    delete cleaned.rollMode
  }
  return cleaned
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
  /** Fills an item/spell/monster's empty/absent `attributes.measurement`
   * at build time — resolved from the project's `mpx.contentLanguage`/
   * `mpx.defaultMeasurement` settings. Defaults to "imperial" (matching
   * old MPX's own ultimate fallback) if not provided. */
  defaultMeasurement?: MeasurementSystem
  /** Resolved from the project's `mpx.contentLanguage` setting — selects
   * which catalog (English/French) generated labels are translated from.
   * Defaults to "en" if not provided. */
  contentLanguage?: ContentLanguage
  /** The project's own `translation-overrides.json`, already loaded and
   * validated by the caller (see loadCatalogOverrides in catalogOverrides.ts)
   * — merged on top of the resolved language's catalog before every lookup. */
  catalogOverrides?: CatalogOverrides
  /** Project-level fallback for an inline spell's `show*` toggles, used only
   * when a spell's own YAML leaves one absent — resolved from the project's
   * mpx.defaultShowSpell* settings. Baked into the page's rendered HTML at
   * build time, same as defaultMeasurement. */
  spellDisplayDefaults?: SpellDisplayDefaults
  /** Same as `spellDisplayDefaults`, for an inline item's `show*` toggles
   * (mpx.defaultShowItem* settings). */
  itemDisplayDefaults?: ItemDisplayDefaults
  /** Same as `spellDisplayDefaults`, for an inline monster's `show*` toggles
   * (mpx.defaultShowMonster* settings). */
  monsterDisplayDefaults?: MonsterDisplayDefaults
  /** Same as `spellDisplayDefaults`, for an inline background's `show*`
   * toggles (mpx.defaultShowBackground* settings). */
  backgroundDisplayDefaults?: BackgroundDisplayDefaults
  /** Resolved from the project's `mpx.autoDetectRollTables` setting — when
   * `false`, a page's Markdown tables are never auto-detected as roll
   * tables, even one whose header links to `/roll/...`. Defaults to `true`
   * if not provided. */
  autoDetectRollTables?: boolean
}

/** Link forms deliberately never checked: an absolute URL (external site),
 * a compendium reference (`/item/`, `/spell/`, `/monster/`, `/roll/`), a
 * same-module page link written in its long form (`/page/...` — same
 * resolution as the bare-slug form, not worth a second check), and a
 * cross-module link (`/module/{module-slug}/page/{page-slug}`) — MPX has no
 * way to know another module's real slugs. Reimplements the original
 * Module Packer's own skip list (`checkForBrokenLinks` in Module.ts), plus
 * `/table-roll/` — installRollTableDetection's own rewritten href for an
 * auto-detected roll table (see markdownRenderer.ts), not a real
 * page/group/map/encounter slug either. */
const BROKEN_LINK_SKIP_PREFIXES = [
  'http://',
  'https://',
  'mailto:',
  'tel:',
  '/item/',
  '/spell/',
  '/monster/',
  '/roll/',
  '/table-roll/',
  '/page/',
  '/module/',
]

/** Scans every page's already-rendered HTML for `<a href>` links that don't
 * resolve to a real page/group/map/encounter slug, or (for a `#anchor`
 * link) a real heading on the same page — reimplementing the original
 * Module Packer's checkForBrokenLinks, but as a non-blocking warning
 * (never a build failure) and, unlike the original (which never actually
 * stripped the leading `#` outside PDF export, so a same-page anchor link
 * always misfired there), with real anchor-link validation. Regex-based
 * rather than a full HTML parser since the input is always our own
 * renderer's predictable output, never arbitrary external HTML. */
function findBrokenLinks(pages: { relativePath: string; slug: string; content: string }[], validSlugs: Set<string>): BuildIssue[] {
  const warnings: BuildIssue[] = []
  for (const page of pages) {
    const anchorIds = new Set<string>()
    for (const match of page.content.matchAll(/<h[1-6][^>]*\sid="([^"]*)"/g)) {
      anchorIds.add(match[1])
    }
    for (const match of page.content.matchAll(/<a\s[^>]*href="([^"]*)"/g)) {
      const href = match[1]
      if (href === '' || BROKEN_LINK_SKIP_PREFIXES.some((prefix) => href.startsWith(prefix))) {
        continue
      }
      if (href.startsWith('#')) {
        if (!anchorIds.has(href.slice(1))) {
          warnings.push({
            file: page.relativePath,
            message: `Possible broken link: "${href}" doesn't match any heading on this page.`,
          })
        }
        continue
      }
      if (!validSlugs.has(href)) {
        warnings.push({
          file: page.relativePath,
          message: `Possible broken link: "${href}" doesn't match any page/group/map/encounter slug.`,
        })
      }
    }
  }
  return warnings
}

export interface InlinePageCompendiumCounts {
  spells: number
  items: number
  monsters: number
  backgrounds: number
  rollTables: number
}

/** A lightweight count of every ```spell/```item/```monster/roll-table block
 * across a project's pages/ — same detection `readPages` (used at build
 * time) relies on, but skipping all its validation/issue-tracking, since
 * this is meant for a quick UI count (the project explorer's Compendium
 * summary line), not a build. Standalone spells/items/monsters/tables
 * folders are a separate, simpler file count the caller already has. */
export async function countInlinePageCompendiumEntries(moduleRoot: string): Promise<InlinePageCompendiumCounts> {
  const markdown = createMarkdownRenderer({ autoDetectRollTables: true })
  const counts: InlinePageCompendiumCounts = { spells: 0, items: 0, monsters: 0, backgrounds: 0, rollTables: 0 }

  for (const filePath of await listFilesRecursively(join(moduleRoot, 'pages'), '.md')) {
    let content: string
    try {
      content = matter(await readFile(filePath, 'utf8')).content
    } catch {
      continue
    }
    const env: MpxMarkdownEnvironment = {}
    markdown.render(content, env)
    counts.spells += env.inlineSpells?.length ?? 0
    counts.items += env.inlineItems?.length ?? 0
    counts.monsters += env.inlineMonsters?.length ?? 0
    counts.backgrounds += env.inlineBackgrounds?.length ?? 0
    counts.rollTables += env.inlineRollTables?.length ?? 0
  }

  return counts
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

  const defaultMeasurement = options.defaultMeasurement ?? 'imperial'
  const moduleId = moduleJson.id as string
  const exportedResources = new Map<string, { data: Buffer; sourceName: string }>()
  const itemImageResources = new Map<string, string>()
  const spellImageResources = new Map<string, string>()
  const monsterImageResources = new Map<string, string>()
  const backgroundImageResources = new Map<string, string>()
  const [pageResult, groups, maps, encounters, items, spells, tables, monsters, backgrounds] = await Promise.all([
    readPages(
      moduleRoot,
      issues,
      defaultMeasurement,
      options.contentLanguage ?? 'en',
      options.catalogOverrides,
      options.spellDisplayDefaults,
      options.itemDisplayDefaults,
      options.monsterDisplayDefaults,
      options.backgroundDisplayDefaults,
      options.autoDetectRollTables ?? true,
    ),
    readGroups(moduleRoot, issues),
    readMapOrEncounterEntries(moduleRoot, 'map', issues, exportedResources),
    readMapOrEncounterEntries(moduleRoot, 'encounter', issues, exportedResources),
    readItems(moduleRoot, issues, itemImageResources, defaultMeasurement),
    readSpells(moduleRoot, issues, spellImageResources, defaultMeasurement),
    readRollTables(moduleRoot, issues),
    readMonsters(moduleRoot, issues, monsterImageResources, defaultMeasurement),
    readBackgrounds(moduleRoot, issues, backgroundImageResources, defaultMeasurement),
  ])
  const {
    entries: pages,
    inlineSpells: inlineSpellSources,
    inlineItems: inlineItemSources,
    inlineMonsters: inlineMonsterSources,
    inlineBackgrounds: inlineBackgroundSources,
    inlineRollTables: inlineRollTableSources,
  } = pageResult
  const entries = [...pages, ...groups, ...maps, ...encounters]

  // Inline ````spell`/````item` blocks merge into the same spells.json/
  // items.json output as standalone files — seed the dedup maps with the
  // standalone entries first, so a collision against either source is
  // caught the same way.
  const spellPathById = new Map(spells.map((spell) => [spell.id as string, 'a standalone spell file']))
  const spellPathBySlug = new Map(spells.map((spell) => [spell.slug as string, 'a standalone spell file']))
  for (const source of inlineSpellSources) {
    const record = await buildInlineSpellRecord(
      moduleRoot,
      source,
      moduleId,
      defaultMeasurement,
      options.spellDisplayDefaults?.addImageToCompendium ?? true,
      issues,
      spellImageResources,
      spellPathById,
      spellPathBySlug,
    )
    if (record) {
      spells.push(record)
    }
  }
  spells.sort((a, b) => String(a.name).localeCompare(String(b.name)))

  const itemPathById = new Map(items.map((item) => [item.id as string, 'a standalone item file']))
  const itemPathBySlug = new Map(items.map((item) => [item.slug as string, 'a standalone item file']))
  for (const source of inlineItemSources) {
    const record = await buildInlineItemRecord(
      moduleRoot,
      source,
      moduleId,
      defaultMeasurement,
      options.itemDisplayDefaults?.addImageToCompendium ?? true,
      issues,
      itemImageResources,
      itemPathById,
      itemPathBySlug,
    )
    if (record) {
      items.push(record)
    }
  }
  items.sort((a, b) => String(a.name).localeCompare(String(b.name)))

  const monsterPathById = new Map(monsters.map((monster) => [monster.id as string, 'a standalone monster file']))
  const monsterPathBySlug = new Map(monsters.map((monster) => [monster.slug as string, 'a standalone monster file']))
  for (const source of inlineMonsterSources) {
    const record = await buildInlineMonsterRecord(
      moduleRoot,
      source,
      moduleId,
      defaultMeasurement,
      options.monsterDisplayDefaults?.addImageToCompendium ?? true,
      options.monsterDisplayDefaults?.addTokenToCompendium ?? true,
      issues,
      monsterImageResources,
      monsterPathById,
      monsterPathBySlug,
    )
    if (record) {
      monsters.push(record)
    }
  }
  monsters.sort((a, b) => String(a.name).localeCompare(String(b.name)))

  const backgroundPathById = new Map(backgrounds.map((background) => [background.id as string, 'a standalone background file']))
  const backgroundPathBySlug = new Map(backgrounds.map((background) => [background.slug as string, 'a standalone background file']))
  for (const source of inlineBackgroundSources) {
    const record = await buildInlineBackgroundRecord(
      moduleRoot,
      source,
      moduleId,
      defaultMeasurement,
      options.backgroundDisplayDefaults?.addImageToCompendium ?? true,
      issues,
      backgroundImageResources,
      backgroundPathById,
      backgroundPathBySlug,
    )
    if (record) {
      backgrounds.push(record)
    }
  }
  backgrounds.sort((a, b) => String(a.name).localeCompare(String(b.name)))

  const tablePathById = new Map(tables.map((table) => [table.id as string, 'a standalone roll table file']))
  const tablePathBySlug = new Map(tables.map((table) => [table.slug as string, 'a standalone roll table file']))
  for (const source of inlineRollTableSources) {
    const record = buildInlineRollTableRecord(source, moduleId, issues, tablePathById, tablePathBySlug)
    if (record) {
      tables.push(record)
    }
  }
  tables.sort((a, b) => String(a.name).localeCompare(String(b.name)))

  if (issues.length > 0) {
    throw new ModuleBuildError(issues)
  }

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

  const brokenLinks = findBrokenLinks(
    entries
      .filter((entry) => entry.kind === 'page')
      .map((entry) => ({ relativePath: entry.relativePath, slug: entry.slug, content: String(entry.record.content) })),
    new Set(entries.map((entry) => entry.slug)),
  )

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
  if (items.length > 0) {
    addJson(items, 'items.json')
  }
  if (spells.length > 0) {
    addJson(spells, 'spells.json')
  }
  if (tables.length > 0) {
    addJson(tables, 'tables.json')
  }
  if (monsters.length > 0) {
    addJson(monsters, 'monsters.json')
  }
  if (backgrounds.length > 0) {
    addJson(backgrounds, 'backgrounds.json')
  }

  await addDirectoryToZip(zip, join(moduleRoot, 'images'), 'images')
  await addDirectoryToZip(zip, join(moduleRoot, 'assets'), 'assets')

  // Map/encounter export resources are merged flat at the archive root —
  // EncounterPlus never sees the original export zips, only their contents.
  for (const [resourceName, resource] of exportedResources) {
    zip.addBuffer(resource.data, resourceName, { compress: false })
  }

  for (const [archivePath, resolvedPath] of itemImageResources) {
    zip.addFile(resolvedPath, archivePath, { compress: false })
  }
  for (const [archivePath, resolvedPath] of spellImageResources) {
    zip.addFile(resolvedPath, archivePath, { compress: false })
  }
  for (const [archivePath, resolvedPath] of monsterImageResources) {
    zip.addFile(resolvedPath, archivePath, { compress: false })
  }
  for (const [archivePath, resolvedPath] of backgroundImageResources) {
    zip.addFile(resolvedPath, archivePath, { compress: false })
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
    itemCount: items.length,
    spellCount: spells.length,
    tableCount: tables.length,
    monsterCount: monsters.length,
    backgroundCount: backgrounds.length,
    builtVersion,
    nextVersion,
    brokenLinks,
  }
}
