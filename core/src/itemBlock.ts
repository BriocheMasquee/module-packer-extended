import { parse as parseYaml } from 'yaml'
import type { MarkdownIt } from 'markdown-it'
import { isNonEmptyString, isPlainObject, type ValidationIssue } from './compendiumShared.js'
import { validateItemData, ITEM_RARITIES, ITEM_MASTERIES, ITEM_PROPERTIES } from './itemCompendium.js'
import { translate, type RenderLocale, type CatalogOverrides } from './catalog.js'
import {
  escapeHtml,
  resourceImagePath,
  resolveAuthoredMeasurement,
  resolveWeightValue,
  formatSources,
  formatTags,
  labelSeparator,
  translateEnum,
  translateEnumOrCustom,
} from './compendiumBlock.js'
import type { MeasurementSystem, ContentLanguage } from './localization.js'

export const ITEM_META_FIELDS = [
  'id',
  'name',
  'slug',
  'attributes',
  'descr',
  'image',
  'addImageToCompendium',
  'sources',
  'showSources',
  'tags',
  'showTags',
] as const
export const ITEM_DATA_FIELDS = [
  'type',
  'typeDetail',
  'rarity',
  'attunement',
  'attunementDetail',
  'value',
  'weight',
  'ac',
  'stealth',
  'str',
  'properties',
  'mastery',
  'dmg1',
  'dmg2',
  'dmgType',
  'range',
  'container',
  'capacity',
] as const

/** Inline ```item` YAML is written flat (no `data:` wrapper) for ease of
 * authoring — this reshapes it into the same { name, slug, data, ... } shape
 * standalone item files use, so the same validateItemData applies to both. */
export function normalizeInlineItem(raw: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const field of ITEM_META_FIELDS) {
    if (raw[field] !== undefined) {
      normalized[field] = raw[field]
    }
  }
  const data: Record<string, unknown> = {}
  for (const field of ITEM_DATA_FIELDS) {
    if (raw[field] !== undefined) {
      data[field] = raw[field]
    }
  }
  if (Object.keys(data).length > 0) {
    normalized.data = data
  }
  return normalized
}

export interface ParsedItemBlock {
  data: Record<string, unknown>
  issues: ValidationIssue[]
}

const INLINE_ITEM_FILE_LABEL = 'inline item block'

/** See the identical hint in spellBlock.ts — same cause (a previous ```item
 * block missing its closing ``` line), just for item blocks instead. */
const UNCLOSED_FENCE_HINT =
  ' A previous ```item block above this one is likely missing its closing ``` line — check that it ends with its own ``` before this block starts.'

export function parseItemBlock(yamlSource: string): ParsedItemBlock {
  const issues: ValidationIssue[] = []
  let raw: unknown
  try {
    raw = parseYaml(yamlSource)
  } catch (error) {
    const hint = /^\s*```/m.test(yamlSource) ? UNCLOSED_FENCE_HINT : ''
    return { data: {}, issues: [{ file: INLINE_ITEM_FILE_LABEL, message: `Invalid YAML: ${(error as Error).message}${hint}` }] }
  }
  if (!isPlainObject(raw)) {
    return { data: {}, issues: [{ file: INLINE_ITEM_FILE_LABEL, message: 'Must be a YAML mapping (key: value pairs).' }] }
  }

  const data = normalizeInlineItem(raw)
  if (!isNonEmptyString(data.name)) {
    issues.push({ file: INLINE_ITEM_FILE_LABEL, message: 'Must contain a non-empty name.' })
  }
  validateItemData(INLINE_ITEM_FILE_LABEL, data.data, issues)
  return { data, issues }
}

/** "custom" is the one item type with no ItemType.Custom entry —
 * Common.Custom covers it. */
function translateItemType(type: string, locale: RenderLocale): string {
  return type === 'custom' ? translate('Common.Custom', locale.language, locale.overrides) : translateEnum('ItemType', type, locale)
}

/** French grammatical gender of each item type's own translated noun (e.g.
 * "Arme"/"Armure" are feminine, "Anneau"/"Bouclier" are masculine) — used
 * only to pick between "Courant"/"Courante" and "Peu courant"/"Peu
 * courante" (every other rarity word is already gender-invariant in
 * French). Confirmed against real 5.5e French SRD item entries (e.g. "Arme
 * (...), peu courante", "Anneau, rare"); not sourced from the EncounterPlus
 * catalog (it has no gender data), so kept as its own table. */
const ITEM_TYPE_FEMININE: Record<string, boolean> = {
  armor: true,
  weapon: true,
  lightArmor: true,
  mediumArmor: true,
  heavyArmor: true,
  meleeWeapon: true,
  rangedWeapon: true,
  ammunition: true,
  wand: true,
  potion: true,
  gemstone: true,
  mount: true,
  tradeGood: true,
  wealth: true,
}

function feminizeFrenchRarity(masculine: string): string {
  if (masculine === 'Courant') {
    return 'Courante'
  }
  if (masculine === 'Peu courant') {
    return 'Peu courante'
  }
  return masculine
}

/** Combines type (+ its free-text detail) and rarity into one subtitle line,
 * e.g. "Melee Weapon, Legendary" — mirrors the official book layout's
 * italic subtitle under the item name. Word order is the same in French
 * (confirmed against real 5.5e French SRD item entries), only "Courant"/
 * "Peu courant" change spelling to agree with the item type's gender. */
function formatSubtitle(data: Record<string, unknown>, locale: RenderLocale): string | undefined {
  const rawType = isNonEmptyString(data.type) ? data.type : undefined
  const type = rawType ? translateItemType(rawType, locale) : undefined
  const typeDetail = isNonEmptyString(data.typeDetail) ? data.typeDetail : undefined
  let rarity = isNonEmptyString(data.rarity) ? translateEnumOrCustom('ItemRarity', data.rarity, ITEM_RARITIES, locale) : undefined
  if (rarity && locale.language === 'fr' && rawType && ITEM_TYPE_FEMININE[rawType]) {
    rarity = feminizeFrenchRarity(rarity)
  }

  const typePart = type ? (typeDetail ? `${type} (${typeDetail})` : type) : typeDetail
  const parts = [typePart, rarity].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(', ') : undefined
}

/** Weight/capacity are authored in whichever unit the item's own
 * `attributes.measurement` says, converted to the project's active unit
 * when it differs — same mechanism as a spell's range/area, see
 * resolveWeightValue. */
function measurementWeightUnit(measurement: MeasurementSystem): string {
  return measurement === 'metric' ? 'kg' : 'lb'
}

function formatWeight(value: unknown, locale: RenderLocale): string | undefined {
  if (typeof value !== 'number' || value <= 0) {
    return undefined
  }
  const resolved = resolveWeightValue(value, locale.authoredMeasurement, locale.measurement)
  return `${resolved} ${measurementWeightUnit(locale.measurement)}`
}

function formatValue(data: Record<string, unknown>): string | undefined {
  return typeof data.value === 'number' && data.value > 0 ? `${data.value} gp` : undefined
}

function formatDamage(data: Record<string, unknown>, locale: RenderLocale): string | undefined {
  const dmg1 = isNonEmptyString(data.dmg1) ? data.dmg1 : undefined
  if (!dmg1) {
    return undefined
  }
  const dmg2 = isNonEmptyString(data.dmg2) ? data.dmg2 : undefined
  const dmgType = isNonEmptyString(data.dmgType) ? translateEnum('Damage', data.dmgType, locale) : undefined
  const dice = dmg2 ? `${dmg1}/${dmg2}` : dmg1
  return dmgType ? `${dice} ${dmgType}` : dice
}

function formatMastery(data: Record<string, unknown>, locale: RenderLocale): string | undefined {
  return isNonEmptyString(data.mastery) ? translateEnumOrCustom('ItemProperty', data.mastery, ITEM_MASTERIES, locale) : undefined
}

function formatItemRange(data: Record<string, unknown>): string | undefined {
  return isNonEmptyString(data.range) ? data.range : undefined
}

function formatProperties(data: Record<string, unknown>, locale: RenderLocale): string | undefined {
  const properties = Array.isArray(data.properties)
    ? data.properties.filter((entry): entry is string => typeof entry === 'string')
    : []
  return properties.length > 0
    ? properties.map((property) => translateEnumOrCustom('ItemProperty', property, ITEM_PROPERTIES, locale)).join(', ')
    : undefined
}

/** Attunement/stealth are boolean flags, not label:value pairs — rendered
 * as a single standalone line of text rather than forced into the
 * label:value shape every other detail line uses (there's no natural
 * "value" for a flag that has no detail text). */
function flagLineHtml(text: string | undefined): string {
  return text ? `<p class="compendium-block-detail">${escapeHtml(text)}</p>` : ''
}

function formatAttunementFlag(data: Record<string, unknown>, locale: RenderLocale): string | undefined {
  if (data.attunement !== true) {
    return undefined
  }
  const detail = isNonEmptyString(data.attunementDetail) ? data.attunementDetail : undefined
  const base = translate('Item.RequiresAttunement', locale.language, locale.overrides)
  return detail ? `${base} (${detail})` : base
}

function formatStealthFlag(data: Record<string, unknown>, locale: RenderLocale): string | undefined {
  return data.stealth === true ? translate('Item.StealthCheckDisadvantage', locale.language, locale.overrides) : undefined
}

function formatArmorClass(data: Record<string, unknown>): string | undefined {
  return typeof data.ac === 'number' && data.ac > 0 ? String(data.ac) : undefined
}

function formatStrRequirement(data: Record<string, unknown>): string | undefined {
  return typeof data.str === 'number' && data.str > 0 ? String(data.str) : undefined
}

function formatContainerCapacity(data: Record<string, unknown>, locale: RenderLocale): string | undefined {
  return data.container === true ? formatWeight(data.capacity, locale) : undefined
}

/** Project-level fallback for each toggle, used only when an item's own
 * YAML leaves the field absent — an explicit value in the item always wins
 * over this default, matching the same spell/measurement pattern. All
 * default to `true` (today's hardcoded behavior). No icon toggles: unlike
 * a spell's school/area-effect icons, an item has no theme-provided icon
 * set.
 *
 * `addImageToCompendium` doesn't control whether the image renders — an
 * `image` field always renders in the page (and preview) once set, no
 * toggle needed there. It controls whether that same image is *also*
 * copied into `items/` and referenced from the item's own built
 * `items.json` entry, so the Compendium's own detail view in
 * EncounterPlus shows it too. See INLINE_IMAGE_PATTERN in
 * compendiumBlock.ts for why an inline item's image lives in `images/`,
 * not `items/`, unlike a standalone item file's. */
export interface ItemDisplayDefaults {
  addImageToCompendium?: boolean
  showSources?: boolean
  showTags?: boolean
}

export interface ItemBlockRenderOptions {
  measurement: MeasurementSystem
  /** Resolved from `mpx.contentLanguage`, same live-refresh getter contract
   * as `measurement` at the `MarkdownRendererOptions` level. Defaults to
   * "en" when not provided (e.g. in tests). */
  language?: ContentLanguage
  /** The project's `translation-overrides.json`, if any — merged on top of
   * the resolved language's catalog before every lookup. */
  overrides?: CatalogOverrides
  preview?: boolean
  displayDefaults?: ItemDisplayDefaults
}

/** Renders a parsed inline item (or a standalone item record, same shape)
 * into the `.compendium-block` markup the 5.5e theme's CSS already styles —
 * shared with spell, since "the bases are identical: top border, fonts,
 * title" (per the layout comparison against the physical book), only the
 * detail lines differ. Unlike spell, the illustration image renders last
 * (after Source/Tags) rather than at the top — an explicit request, since
 * an item's image is a "nice to have" extra rather than its focal point. */
export function renderItemBlockHtml(data: Record<string, unknown>, markdown: MarkdownIt, options: ItemBlockRenderOptions): string {
  const locale: RenderLocale = {
    measurement: options.measurement,
    language: options.language ?? 'en',
    overrides: options.overrides,
    authoredMeasurement: resolveAuthoredMeasurement(data.attributes),
  }
  const name = isNonEmptyString(data.name) ? data.name : 'Unnamed Item'
  const itemData = isPlainObject(data.data) ? data.data : {}

  const detailLine = (label: string, value: string | undefined): string => {
    if (!value) {
      return ''
    }
    return `<p class="compendium-block-detail"><span class="compendium-block-detail-label">${escapeHtml(label)}${labelSeparator(locale.language)}</span><span class="compendium-block-detail-value">${escapeHtml(value)}</span></p>`
  }

  const subtitle = formatSubtitle(itemData, locale)
  const descriptionHtml = isNonEmptyString(data.descr)
    ? `<div class="compendium-block-description">${markdown.render(data.descr)}</div>`
    : ''

  // "images/" (no file name) is the snippet's own untouched placeholder,
  // matching how a standalone item file treats "items/" that same way for
  // "no image set" rather than a literal (broken) path to render. Renders
  // unconditionally once set — addImageToCompendium only controls whether
  // the build also copies it into items/ for the Compendium's own detail
  // view, not whether it shows here.
  const hasImage = isNonEmptyString(data.image) && data.image !== 'images/'
  const imageHtml = hasImage
    ? `<div class="compendium-image-block"><img class="compendium-image" src="${escapeHtml(resourceImagePath(String(data.image), options.preview))}" alt=""></div>`
    : ''

  const showSourcesDefault = options.displayDefaults?.showSources ?? true
  const showSources = typeof data.showSources === 'boolean' ? data.showSources : showSourcesDefault
  const showTagsDefault = options.displayDefaults?.showTags ?? true
  const showTags = typeof data.showTags === 'boolean' ? data.showTags : showTagsDefault
  const sourcesText = showSources ? formatSources(data.sources, locale.language) : undefined
  const tagsText = showTags ? formatTags(data.tags) : undefined
  const footerLines = [
    detailLine(translate('Common.Source', locale.language, locale.overrides), sourcesText),
    detailLine(translate('Common.Tags', locale.language, locale.overrides), tagsText),
  ]
    .filter(Boolean)
    .join('')
  const footerHtml = footerLines ? `<div class="compendium-block-details compendium-block-details-footer">${footerLines}</div>` : ''

  return [
    '<div class="compendium-block">',
    '<div class="compendium-block-top-border"></div>',
    `<div class="compendium-block-title">${escapeHtml(name)}</div>`,
    subtitle ? `<div class="compendium-block-heading">${escapeHtml(subtitle)}</div>` : '',
    '<div class="compendium-block-body">',
    '<div class="compendium-block-details">',
    detailLine(translate('Common.Weight', locale.language, locale.overrides), formatWeight(itemData.weight, locale)),
    detailLine(translate('Common.Value', locale.language, locale.overrides), formatValue(itemData)),
    detailLine(translate('Common.Damage', locale.language, locale.overrides), formatDamage(itemData, locale)),
    detailLine(translate('Item.Mastery', locale.language, locale.overrides), formatMastery(itemData, locale)),
    detailLine(translate('Common.Range', locale.language, locale.overrides), formatItemRange(itemData)),
    detailLine(translate('Item.Properties', locale.language, locale.overrides), formatProperties(itemData, locale)),
    detailLine(translate('Common.AC', locale.language, locale.overrides), formatArmorClass(itemData)),
    detailLine(translate('Item.STRRequirement', locale.language, locale.overrides), formatStrRequirement(itemData)),
    flagLineHtml(formatStealthFlag(itemData, locale)),
    flagLineHtml(formatAttunementFlag(itemData, locale)),
    detailLine(translate('Item.ContainerCapacity', locale.language, locale.overrides), formatContainerCapacity(itemData, locale)),
    '</div>',
    descriptionHtml,
    footerHtml,
    imageHtml,
    '</div>',
    '</div>',
  ]
    .filter(Boolean)
    .join('')
}
