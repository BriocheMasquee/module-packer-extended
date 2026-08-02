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
import { COMPENDIUM_RULESET } from './compendiumEntries.js'
import type { MeasurementSystem } from './localization.js'

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

function isEmptyOptionalValue(value: unknown): boolean {
  return (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0)
}

function stripEmptyValues(record: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const cleaned = { ...record }
  for (const field of fields) {
    if (isEmptyOptionalValue(cleaned[field])) {
      delete cleaned[field]
    }
  }
  return cleaned
}

/** EncounterPlus expects an unset optional field to be absent from
 * module.json, not an empty string/array — the project's own module.json
 * still keeps every field, for editing; only the built copy is trimmed. */
function stripEmptyOptionalFields(moduleJson: Record<string, unknown>): Record<string, unknown> {
  return stripEmptyValues(moduleJson, MODULE_JSON_OPTIONAL_FIELDS)
}

/** Strips a nested object's own empty optional fields in place, then drops
 * the whole field if nothing meaningful is left in it. */
function stripEmptyNestedField(record: Record<string, unknown>, field: string, optionalFields: readonly string[]): void {
  if (!isPlainObject(record[field])) {
    return
  }
  const cleaned = stripEmptyValues(record[field], optionalFields)
  if (Object.keys(cleaned).length === 0) {
    delete record[field]
  } else {
    record[field] = cleaned
  }
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

const ITEM_TYPES = [
  '',
  'custom',
  'armor',
  'weapon',
  'lightArmor',
  'mediumArmor',
  'heavyArmor',
  'shield',
  'meleeWeapon',
  'rangedWeapon',
  'ammunition',
  'rod',
  'staff',
  'wand',
  'potion',
  'ring',
  'scroll',
  'wondrousItem',
  'adventuringGear',
  'wealth',
  'gemstone',
  'tool',
  'poison',
  'instrument',
  'arcaneFocus',
  'holySymbol',
  'mount',
  'equipmentPack',
  'tradeGood',
  'druidicFocus',
  'vehicleLand',
  'vehicleWater',
  'vehicleSpace',
]
const ITEM_RARITIES = ['', 'common', 'uncommon', 'rare', 'veryrare', 'legendary', 'artifact', 'unknown']
const ITEM_PROPERTIES = [
  'ammunition',
  'finesse',
  'heavy',
  'light',
  'loading',
  'range',
  'reach',
  'special',
  'thrown',
  'twoHanded',
  'versatile',
  'cleave',
  'graze',
  'nick',
  'push',
  'sap',
  'slow',
  'topple',
  'vex',
]
const ITEM_MASTERIES = ['', 'cleave', 'graze', 'nick', 'push', 'sap', 'slow', 'topple', 'vex']
const ITEM_DAMAGE_TYPES = [
  '',
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
]
const ITEM_IMAGE_PATTERN = /^items\/[^/\\]+$/

const COMPENDIUM_ATTRIBUTES_OPTIONAL_FIELDS = ['measurement', 'ruleset']

const ITEM_TOP_LEVEL_OPTIONAL_FIELDS = ['descr', 'sources', 'tags']
const ITEM_DATA_OPTIONAL_FIELDS = [
  'type',
  'typeDetail',
  'rarity',
  'attunementDetail',
  'mastery',
  'dmg1',
  'dmg2',
  'dmgType',
  'range',
  'properties',
]

/** EncounterPlus stores an unfilled data/attributes field as absent, not as
 * an empty string/array — the project's own item file still keeps every
 * field, for editing; only the built copy is trimmed. Unlike module.json,
 * a nested object (attributes/data) that ends up fully empty is dropped
 * entirely rather than left behind as `{}`. */
function stripEmptyItemFields(item: Record<string, unknown>): Record<string, unknown> {
  const cleaned = stripEmptyValues(item, ITEM_TOP_LEVEL_OPTIONAL_FIELDS)
  stripEmptyNestedField(cleaned, 'attributes', COMPENDIUM_ATTRIBUTES_OPTIONAL_FIELDS)
  stripEmptyNestedField(cleaned, 'data', ITEM_DATA_OPTIONAL_FIELDS)
  return cleaned
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateItemData(relativePath: string, data: unknown, issues: BuildIssue[]): void {
  if (data === undefined) {
    return
  }
  if (!isPlainObject(data)) {
    issues.push({ file: relativePath, message: 'data must be an object when provided.' })
    return
  }
  if (data.type !== undefined && !ITEM_TYPES.includes(data.type as string)) {
    issues.push({ file: relativePath, message: `data.type "${String(data.type)}" is not a recognized item type.` })
  }
  if (data.rarity !== undefined && !ITEM_RARITIES.includes(data.rarity as string)) {
    issues.push({ file: relativePath, message: `data.rarity "${String(data.rarity)}" is not a recognized rarity.` })
  }
  if (data.dmgType !== undefined && !ITEM_DAMAGE_TYPES.includes(data.dmgType as string)) {
    issues.push({ file: relativePath, message: `data.dmgType "${String(data.dmgType)}" is not a recognized damage type.` })
  }
  if (data.mastery !== undefined && !ITEM_MASTERIES.includes(data.mastery as string)) {
    issues.push({ file: relativePath, message: `data.mastery "${String(data.mastery)}" is not a recognized mastery.` })
  }
  if (
    data.properties !== undefined &&
    (!Array.isArray(data.properties) || !data.properties.every((property) => ITEM_PROPERTIES.includes(property)))
  ) {
    issues.push({ file: relativePath, message: 'data.properties must be an array of recognized item properties.' })
  }
  for (const field of ['value', 'weight', 'ac', 'str', 'capacity']) {
    if (data[field] !== undefined && typeof data[field] !== 'number') {
      issues.push({ file: relativePath, message: `data.${field} must be a number when provided.` })
    }
  }
  for (const field of ['attunement', 'stealth', 'container']) {
    if (data[field] !== undefined && typeof data[field] !== 'boolean') {
      issues.push({ file: relativePath, message: `data.${field} must be a boolean when provided.` })
    }
  }
  for (const field of ['typeDetail', 'attunementDetail', 'dmg1', 'dmg2', 'range']) {
    if (data[field] !== undefined && typeof data[field] !== 'string') {
      issues.push({ file: relativePath, message: `data.${field} must be a string when provided.` })
    }
  }
}

const SPELL_SCHOOLS = [
  '',
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
]
const SPELL_ACTIVATION_UNITS = ['', 'action', 'bonusAction', 'reaction', 'hour', 'minute']
const SPELL_RANGE_TYPES = ['', 'self', 'touch', 'sight', 'unlimited']
const SPELL_AREA_EFFECT_SHAPES = ['', 'cone', 'cube', 'cylinder', 'line', 'square', 'sphere', 'emanation']
const SPELL_COMPONENTS = ['V', 'S', 'M']
const SPELL_DURATION_TYPES = ['', 'concentration', 'instantaneous', 'special', 'dispel', 'dispelOrTrigger']
const SPELL_DURATION_UNITS = ['', 'round', 'minute', 'hour', 'day']
const SPELL_IMAGE_PATTERN = /^spells\/[^/\\]+$/

const SPELL_TOP_LEVEL_OPTIONAL_FIELDS = ['descr', 'sources', 'tags']
const SPELL_DATA_OPTIONAL_FIELDS = [
  'school',
  'rangeType',
  'areaEffectShape',
  'componentsDetail',
  'durationType',
  'durationUnit',
  'components',
  'classes',
]
const SPELL_ACTIVATION_OPTIONAL_FIELDS = ['unit', 'condition']

function validateSpellData(relativePath: string, data: unknown, issues: BuildIssue[]): void {
  if (data === undefined) {
    return
  }
  if (!isPlainObject(data)) {
    issues.push({ file: relativePath, message: 'data must be an object when provided.' })
    return
  }
  if (
    data.level !== undefined &&
    (typeof data.level !== 'number' || !Number.isInteger(data.level) || data.level < 0 || data.level > 9)
  ) {
    issues.push({ file: relativePath, message: 'data.level must be an integer between 0 and 9 when provided.' })
  }
  if (data.school !== undefined && !SPELL_SCHOOLS.includes(data.school as string)) {
    issues.push({ file: relativePath, message: `data.school "${String(data.school)}" is not a recognized spell school.` })
  }
  if (data.ritual !== undefined && typeof data.ritual !== 'boolean') {
    issues.push({ file: relativePath, message: 'data.ritual must be a boolean when provided.' })
  }
  if (data.activation !== undefined) {
    if (!isPlainObject(data.activation)) {
      issues.push({ file: relativePath, message: 'data.activation must be an object when provided.' })
    } else {
      const activation = data.activation
      if (activation.time !== undefined && typeof activation.time !== 'number') {
        issues.push({ file: relativePath, message: 'data.activation.time must be a number when provided.' })
      }
      if (activation.unit !== undefined && !SPELL_ACTIVATION_UNITS.includes(activation.unit as string)) {
        issues.push({
          file: relativePath,
          message: `data.activation.unit "${String(activation.unit)}" is not a recognized activation unit.`,
        })
      }
      if (activation.condition !== undefined && typeof activation.condition !== 'string') {
        issues.push({ file: relativePath, message: 'data.activation.condition must be a string when provided.' })
      }
    }
  }
  if (data.rangeType !== undefined && !SPELL_RANGE_TYPES.includes(data.rangeType as string)) {
    issues.push({ file: relativePath, message: `data.rangeType "${String(data.rangeType)}" is not a recognized range type.` })
  }
  if (data.range !== undefined && typeof data.range !== 'number') {
    issues.push({ file: relativePath, message: 'data.range must be a number when provided.' })
  }
  if (data.areaEffectShape !== undefined && !SPELL_AREA_EFFECT_SHAPES.includes(data.areaEffectShape as string)) {
    issues.push({
      file: relativePath,
      message: `data.areaEffectShape "${String(data.areaEffectShape)}" is not a recognized area effect shape.`,
    })
  }
  if (data.areaEffectSize !== undefined && typeof data.areaEffectSize !== 'number') {
    issues.push({ file: relativePath, message: 'data.areaEffectSize must be a number when provided.' })
  }
  if (
    data.components !== undefined &&
    (!Array.isArray(data.components) || !data.components.every((component) => SPELL_COMPONENTS.includes(component)))
  ) {
    issues.push({ file: relativePath, message: 'data.components must be an array of recognized spell components.' })
  }
  if (data.componentsDetail !== undefined && typeof data.componentsDetail !== 'string') {
    issues.push({ file: relativePath, message: 'data.componentsDetail must be a string when provided.' })
  }
  if (data.durationType !== undefined && !SPELL_DURATION_TYPES.includes(data.durationType as string)) {
    issues.push({
      file: relativePath,
      message: `data.durationType "${String(data.durationType)}" is not a recognized duration type.`,
    })
  }
  if (data.duration !== undefined && typeof data.duration !== 'number') {
    issues.push({ file: relativePath, message: 'data.duration must be a number when provided.' })
  }
  if (data.durationUnit !== undefined && !SPELL_DURATION_UNITS.includes(data.durationUnit as string)) {
    issues.push({
      file: relativePath,
      message: `data.durationUnit "${String(data.durationUnit)}" is not a recognized duration unit.`,
    })
  }
  if (
    data.classes !== undefined &&
    (!Array.isArray(data.classes) || !data.classes.every((entry) => typeof entry === 'string'))
  ) {
    issues.push({ file: relativePath, message: 'data.classes must be an array of strings when provided.' })
  }
}

function stripEmptySpellFields(spell: Record<string, unknown>): Record<string, unknown> {
  const cleaned = stripEmptyValues(spell, SPELL_TOP_LEVEL_OPTIONAL_FIELDS)
  stripEmptyNestedField(cleaned, 'attributes', COMPENDIUM_ATTRIBUTES_OPTIONAL_FIELDS)
  if (isPlainObject(cleaned.data)) {
    const data = stripEmptyValues(cleaned.data, SPELL_DATA_OPTIONAL_FIELDS)
    stripEmptyNestedField(data, 'activation', SPELL_ACTIVATION_OPTIONAL_FIELDS)
    if (Object.keys(data).length === 0) {
      delete cleaned.data
    } else {
      cleaned.data = data
    }
  }
  return cleaned
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

const MONSTER_SIZES = ['', 'T', 'S', 'M', 'L', 'H', 'G', 'C']
const MONSTER_TYPES = [
  '',
  'aberration',
  'beast',
  'celestial',
  'construct',
  'dragon',
  'elemental',
  'fey',
  'fiend',
  'giant',
  'humanoid',
  'monstrosity',
  'ooze',
  'plant',
  'undead',
]
const MONSTER_ALIGNMENTS = ['', 'LG', 'NG', 'CG', 'LN', 'NN', 'CN', 'LE', 'NE', 'CE', 'UU']
const MONSTER_ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha']
const MONSTER_SKILLS = [
  'acrobatics',
  'animalHandling',
  'arcana',
  'athletics',
  'deception',
  'history',
  'insight',
  'intimidation',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'performance',
  'persuasion',
  'religion',
  'sleightOfHand',
  'stealth',
  'survival',
]
const MONSTER_DAMAGE_TYPES = ITEM_DAMAGE_TYPES.filter((value) => value !== '')
/** Challenge rating is a closed list, confirmed against EncounterPlus's own
 * `ChallengeRatingToXP` table: 0, the three sub-1 fractions, then 1-30. */
const MONSTER_CHALLENGE_RATINGS = [
  '',
  '0',
  '1/8',
  '1/4',
  '1/2',
  ...Array.from({ length: 30 }, (_, index) => String(index + 1)),
]
const MONSTER_FEATURE_LIST_FIELDS = ['traits', 'actions', 'bonusActions', 'reactions', 'legendaryActions']
const MONSTER_IMAGE_PATTERN = /^monsters\/[^/\\]+$/

const MONSTER_TOP_LEVEL_OPTIONAL_FIELDS = ['descr', 'sources', 'tags']
const MONSTER_DATA_OPTIONAL_FIELDS = [
  'size',
  'type',
  'typeDetail',
  'alignment',
  'ac',
  'hp',
  'conditionImmunities',
  'damageImmunities',
  'damageResistances',
  'damageVulnerabilities',
  'languages',
  'cr',
  'environments',
  ...MONSTER_FEATURE_LIST_FIELDS,
]
const MONSTER_SPEED_OPTIONAL_FIELDS = ['other']
const MONSTER_SENSES_OPTIONAL_FIELDS = ['other']

/** `traits`/`actions`/`bonusActions`/`reactions`/`legendaryActions` entries
 * are `{ name, text, usage? }` — confirmed against a real compiled
 * monsters.json export (not `{ name, description }` as an earlier,
 * unverified reading of the old MPX code assumed). No `mythicActions`: a
 * 5.5e-era leftover no longer used, omitted entirely. */
function validateMonsterFeatureList(
  relativePath: string,
  fieldName: string,
  value: unknown,
  issues: BuildIssue[],
): void {
  if (value === undefined) {
    return
  }
  if (!Array.isArray(value)) {
    issues.push({ file: relativePath, message: `data.${fieldName} must be an array when provided.` })
    return
  }
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      issues.push({ file: relativePath, message: `data.${fieldName} entries must be objects.` })
      continue
    }
    if (entry.name !== undefined && typeof entry.name !== 'string') {
      issues.push({ file: relativePath, message: `data.${fieldName} entries' name must be a string when provided.` })
    }
    if (entry.text !== undefined && typeof entry.text !== 'string') {
      issues.push({ file: relativePath, message: `data.${fieldName} entries' text must be a string when provided.` })
    }
    if (entry.usage !== undefined && typeof entry.usage !== 'string') {
      issues.push({ file: relativePath, message: `data.${fieldName} entries' usage must be a string when provided.` })
    }
  }
}

/** `conditionImmunities` references EncounterPlus's "Rule" entities (filtered
 * to conditions), which aren't a content type MPX supports yet — treated as
 * free-form strings, same as a spell's `classes`. */
function validateMonsterData(relativePath: string, data: unknown, issues: BuildIssue[]): void {
  if (data === undefined) {
    return
  }
  if (!isPlainObject(data)) {
    issues.push({ file: relativePath, message: 'data must be an object when provided.' })
    return
  }
  if (data.size !== undefined && !MONSTER_SIZES.includes(data.size as string)) {
    issues.push({ file: relativePath, message: `data.size "${String(data.size)}" is not a recognized size.` })
  }
  if (data.type !== undefined && !MONSTER_TYPES.includes(data.type as string)) {
    issues.push({ file: relativePath, message: `data.type "${String(data.type)}" is not a recognized monster type.` })
  }
  if (data.typeDetail !== undefined && typeof data.typeDetail !== 'string') {
    issues.push({ file: relativePath, message: 'data.typeDetail must be a string when provided.' })
  }
  if (data.alignment !== undefined && !MONSTER_ALIGNMENTS.includes(data.alignment as string)) {
    issues.push({ file: relativePath, message: `data.alignment "${String(data.alignment)}" is not a recognized alignment.` })
  }
  if (data.ac !== undefined && typeof data.ac !== 'string') {
    issues.push({ file: relativePath, message: 'data.ac must be a string when provided.' })
  }
  if (data.hp !== undefined && typeof data.hp !== 'string') {
    issues.push({ file: relativePath, message: 'data.hp must be a string when provided.' })
  }
  if (data.speed !== undefined) {
    if (!isPlainObject(data.speed)) {
      issues.push({ file: relativePath, message: 'data.speed must be an object when provided.' })
    } else {
      const speed = data.speed
      for (const field of ['walk', 'burrow', 'climb', 'fly', 'swim']) {
        if (speed[field] !== undefined && typeof speed[field] !== 'number') {
          issues.push({ file: relativePath, message: `data.speed.${field} must be a number when provided.` })
        }
      }
      if (speed.hover !== undefined && typeof speed.hover !== 'boolean') {
        issues.push({ file: relativePath, message: 'data.speed.hover must be a boolean when provided.' })
      }
      if (speed.other !== undefined && typeof speed.other !== 'string') {
        issues.push({ file: relativePath, message: 'data.speed.other must be a string when provided.' })
      }
    }
  }
  if (data.abilities !== undefined) {
    if (!isPlainObject(data.abilities)) {
      issues.push({ file: relativePath, message: 'data.abilities must be an object when provided.' })
    } else {
      for (const field of MONSTER_ABILITY_KEYS) {
        if (data.abilities[field] !== undefined && typeof data.abilities[field] !== 'number') {
          issues.push({ file: relativePath, message: `data.abilities.${field} must be a number when provided.` })
        }
      }
    }
  }
  if (data.savingThrows !== undefined) {
    if (!isPlainObject(data.savingThrows)) {
      issues.push({ file: relativePath, message: 'data.savingThrows must be an object when provided.' })
    } else {
      for (const [key, value] of Object.entries(data.savingThrows)) {
        if (!MONSTER_ABILITY_KEYS.includes(key)) {
          issues.push({ file: relativePath, message: `data.savingThrows key "${key}" is not a recognized ability.` })
        } else if (typeof value !== 'number') {
          issues.push({ file: relativePath, message: `data.savingThrows.${key} must be a number.` })
        }
      }
    }
  }
  if (data.skills !== undefined) {
    if (!isPlainObject(data.skills)) {
      issues.push({ file: relativePath, message: 'data.skills must be an object when provided.' })
    } else {
      for (const [key, value] of Object.entries(data.skills)) {
        if (!MONSTER_SKILLS.includes(key)) {
          issues.push({ file: relativePath, message: `data.skills key "${key}" is not a recognized skill.` })
        } else if (typeof value !== 'number') {
          issues.push({ file: relativePath, message: `data.skills.${key} must be a number.` })
        }
      }
    }
  }
  if (
    data.conditionImmunities !== undefined &&
    (!Array.isArray(data.conditionImmunities) || !data.conditionImmunities.every((value) => typeof value === 'string'))
  ) {
    issues.push({ file: relativePath, message: 'data.conditionImmunities must be an array of strings when provided.' })
  }
  for (const field of ['damageImmunities', 'damageResistances', 'damageVulnerabilities']) {
    const value = data[field]
    if (value !== undefined && (!Array.isArray(value) || !value.every((entry) => MONSTER_DAMAGE_TYPES.includes(entry)))) {
      issues.push({ file: relativePath, message: `data.${field} must be an array of recognized damage types.` })
    }
  }
  if (data.senses !== undefined) {
    if (!isPlainObject(data.senses)) {
      issues.push({ file: relativePath, message: 'data.senses must be an object when provided.' })
    } else {
      const senses = data.senses
      for (const field of ['blindsight', 'darkvision', 'tremorsense', 'truesight']) {
        if (senses[field] !== undefined && typeof senses[field] !== 'number') {
          issues.push({ file: relativePath, message: `data.senses.${field} must be a number when provided.` })
        }
      }
      if (senses.other !== undefined && typeof senses.other !== 'string') {
        issues.push({ file: relativePath, message: 'data.senses.other must be a string when provided.' })
      }
    }
  }
  if (data.passivePerception !== undefined && typeof data.passivePerception !== 'number') {
    issues.push({ file: relativePath, message: 'data.passivePerception must be a number when provided.' })
  }
  if (
    data.languages !== undefined &&
    (!Array.isArray(data.languages) || !data.languages.every((value) => typeof value === 'string'))
  ) {
    // The real form allows a custom, freely-typed entry alongside the
    // standard language list, so any string is accepted here.
    issues.push({ file: relativePath, message: 'data.languages must be an array of strings when provided.' })
  }
  if (data.cr !== undefined && !MONSTER_CHALLENGE_RATINGS.includes(data.cr as string)) {
    issues.push({ file: relativePath, message: `data.cr "${String(data.cr)}" is not a recognized challenge rating.` })
  }
  for (const field of ['initiativeBonus', 'proficiencyBonus']) {
    if (data[field] !== undefined && typeof data[field] !== 'number') {
      issues.push({ file: relativePath, message: `data.${field} must be a number when provided.` })
    }
  }
  if (
    data.environments !== undefined &&
    (!Array.isArray(data.environments) || !data.environments.every((value) => typeof value === 'string'))
  ) {
    // Same as languages: a custom entry is allowed alongside the standard list.
    issues.push({ file: relativePath, message: 'data.environments must be an array of strings when provided.' })
  }
  for (const field of MONSTER_FEATURE_LIST_FIELDS) {
    validateMonsterFeatureList(relativePath, field, data[field], issues)
  }
}

function stripEmptyMonsterFields(monster: Record<string, unknown>): Record<string, unknown> {
  const cleaned = stripEmptyValues(monster, MONSTER_TOP_LEVEL_OPTIONAL_FIELDS)
  stripEmptyNestedField(cleaned, 'attributes', COMPENDIUM_ATTRIBUTES_OPTIONAL_FIELDS)
  if (isPlainObject(cleaned.data)) {
    const data = stripEmptyValues(cleaned.data, MONSTER_DATA_OPTIONAL_FIELDS)
    stripEmptyNestedField(data, 'speed', MONSTER_SPEED_OPTIONAL_FIELDS)
    stripEmptyNestedField(data, 'senses', MONSTER_SENSES_OPTIONAL_FIELDS)
    for (const field of ['savingThrows', 'skills']) {
      if (isPlainObject(data[field]) && Object.keys(data[field]).length === 0) {
        delete data[field]
      }
    }
    if (Object.keys(data).length === 0) {
      delete cleaned.data
    } else {
      cleaned.data = data
    }
  }
  return cleaned
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

const ROLL_TABLE_ROLL_MODES = ['normal', 'noRepeat', 'eachRow']
const ROLL_TABLE_OPTIONAL_FIELDS = ['descr', 'sources', 'tags']

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
  const exportedResources = new Map<string, { data: Buffer; sourceName: string }>()
  const itemImageResources = new Map<string, string>()
  const spellImageResources = new Map<string, string>()
  const monsterImageResources = new Map<string, string>()
  const [pages, groups, maps, encounters, items, spells, tables, monsters] = await Promise.all([
    readPages(moduleRoot, issues),
    readGroups(moduleRoot, issues),
    readMapOrEncounterEntries(moduleRoot, 'map', issues, exportedResources),
    readMapOrEncounterEntries(moduleRoot, 'encounter', issues, exportedResources),
    readItems(moduleRoot, issues, itemImageResources, defaultMeasurement),
    readSpells(moduleRoot, issues, spellImageResources, defaultMeasurement),
    readRollTables(moduleRoot, issues),
    readMonsters(moduleRoot, issues, monsterImageResources, defaultMeasurement),
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
    builtVersion,
    nextVersion,
  }
}
