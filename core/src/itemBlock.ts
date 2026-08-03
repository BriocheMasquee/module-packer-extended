import { parse as parseYaml } from 'yaml'
import type { MarkdownIt } from 'markdown-it'
import { isNonEmptyString, isPlainObject, type ValidationIssue } from './compendiumShared.js'
import { validateItemData } from './itemCompendium.js'
import { translate } from './catalogEn.js'
import { escapeHtml, resourceImagePath, formatSources, formatTags } from './compendiumBlock.js'
import type { MeasurementSystem } from './localization.js'

const ITEM_META_FIELDS = [
  'id',
  'name',
  'slug',
  'attributes',
  'descr',
  'image',
  'showImage',
  'sources',
  'showSources',
  'tags',
  'showTags',
] as const
const ITEM_DATA_FIELDS = [
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

/** Catalog keys follow `{Namespace}.{PascalCase(enumKey)}` — same pattern
 * confirmed for spell enums (see spellBlock.ts's translateEnum). "custom" is
 * the one item type with no ItemType.Custom entry — Common.Custom covers it. */
function translateEnum(namespace: string, enumKey: string): string {
  const pascalKey = enumKey.charAt(0).toUpperCase() + enumKey.slice(1)
  return translate(`${namespace}.${pascalKey}`)
}

function translateItemType(type: string): string {
  return type === 'custom' ? translate('Common.Custom') : translateEnum('ItemType', type)
}

/** Combines type (+ its free-text detail) and rarity into one subtitle line,
 * e.g. "Melee Weapon, Legendary" — mirrors the official book layout's
 * italic subtitle under the item name. */
function formatSubtitle(data: Record<string, unknown>): string | undefined {
  const type = isNonEmptyString(data.type) ? translateItemType(data.type) : undefined
  const typeDetail = isNonEmptyString(data.typeDetail) ? data.typeDetail : undefined
  const rarity = isNonEmptyString(data.rarity) ? translateEnum('ItemRarity', data.rarity) : undefined

  const typePart = type ? (typeDetail ? `${type} (${typeDetail})` : type) : typeDetail
  const parts = [typePart, rarity].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(', ') : undefined
}

/** Weight/capacity are authored directly in the project's active measurement
 * unit (kg when metric, lb when imperial) — unlike a spell's range/area,
 * there's no single canonical unit to convert from, so the number is shown
 * as-is with just the matching unit word. */
function measurementWeightUnit(measurement: MeasurementSystem): string {
  return measurement === 'metric' ? 'kg' : 'lb'
}

function formatWeight(value: unknown, measurement: MeasurementSystem): string | undefined {
  return typeof value === 'number' && value > 0 ? `${value} ${measurementWeightUnit(measurement)}` : undefined
}

function formatValue(data: Record<string, unknown>): string | undefined {
  return typeof data.value === 'number' && data.value > 0 ? `${data.value} gp` : undefined
}

function formatDamage(data: Record<string, unknown>): string | undefined {
  const dmg1 = isNonEmptyString(data.dmg1) ? data.dmg1 : undefined
  if (!dmg1) {
    return undefined
  }
  const dmg2 = isNonEmptyString(data.dmg2) ? data.dmg2 : undefined
  const dmgType = isNonEmptyString(data.dmgType) ? translateEnum('Damage', data.dmgType) : undefined
  const dice = dmg2 ? `${dmg1}/${dmg2}` : dmg1
  return dmgType ? `${dice} ${dmgType}` : dice
}

function formatMastery(data: Record<string, unknown>): string | undefined {
  return isNonEmptyString(data.mastery) ? translateEnum('ItemProperty', data.mastery) : undefined
}

function formatItemRange(data: Record<string, unknown>): string | undefined {
  return isNonEmptyString(data.range) ? data.range : undefined
}

function formatProperties(data: Record<string, unknown>): string | undefined {
  const properties = Array.isArray(data.properties)
    ? data.properties.filter((entry): entry is string => typeof entry === 'string')
    : []
  return properties.length > 0 ? properties.map((property) => translateEnum('ItemProperty', property)).join(', ') : undefined
}

/** Attunement/stealth are boolean flags, not label:value pairs — rendered
 * as a single standalone line of text rather than forced into the
 * label:value shape every other detail line uses (there's no natural
 * "value" for a flag that has no detail text). */
function flagLineHtml(text: string | undefined): string {
  return text ? `<p class="compendium-block-detail">${escapeHtml(text)}</p>` : ''
}

function formatAttunementFlag(data: Record<string, unknown>): string | undefined {
  if (data.attunement !== true) {
    return undefined
  }
  const detail = isNonEmptyString(data.attunementDetail) ? data.attunementDetail : undefined
  const base = translate('Item.RequiresAttunement')
  return detail ? `${base} (${detail})` : base
}

function formatStealthFlag(data: Record<string, unknown>): string | undefined {
  return data.stealth === true ? translate('Item.StealthCheckDisadvantage') : undefined
}

function formatArmorClass(data: Record<string, unknown>): string | undefined {
  return typeof data.ac === 'number' && data.ac > 0 ? String(data.ac) : undefined
}

function formatStrRequirement(data: Record<string, unknown>): string | undefined {
  return typeof data.str === 'number' && data.str > 0 ? String(data.str) : undefined
}

function formatContainerCapacity(data: Record<string, unknown>, measurement: MeasurementSystem): string | undefined {
  return data.container === true ? formatWeight(data.capacity, measurement) : undefined
}

/** Project-level fallback for each `show*` toggle, used only when an item's
 * own YAML leaves the field absent — an explicit `true`/`false` in the item
 * always wins over this default, matching the same spell/measurement
 * pattern. All default to `true` (today's hardcoded behavior). No icon
 * toggles: unlike a spell's school/area-effect icons, an item has no
 * theme-provided icon set. */
export interface ItemDisplayDefaults {
  showImage?: boolean
  showSources?: boolean
  showTags?: boolean
}

export interface ItemBlockRenderOptions {
  measurement: MeasurementSystem
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
  const name = isNonEmptyString(data.name) ? data.name : 'Unnamed Item'
  const itemData = isPlainObject(data.data) ? data.data : {}

  const detailLine = (label: string, value: string | undefined): string => {
    if (!value) {
      return ''
    }
    return `<p class="compendium-block-detail"><span class="compendium-block-detail-label">${escapeHtml(label)}: </span><span class="compendium-block-detail-value">${escapeHtml(value)}</span></p>`
  }

  const subtitle = formatSubtitle(itemData)
  const descriptionHtml = isNonEmptyString(data.descr)
    ? `<div class="compendium-block-description">${markdown.render(data.descr)}</div>`
    : ''

  // "items/" (no file name) is the snippet's own untouched placeholder,
  // matching how a standalone item file treats that same value as "no
  // image set" rather than a literal (broken) path to render.
  const hasImage = isNonEmptyString(data.image) && data.image !== 'items/'
  const showImageDefault = options.displayDefaults?.showImage ?? true
  const showImage = (typeof data.showImage === 'boolean' ? data.showImage : showImageDefault) && hasImage
  const imageHtml = showImage
    ? `<div class="compendium-image-block"><img class="compendium-image" src="${escapeHtml(resourceImagePath(String(data.image), options.preview))}" alt=""></div>`
    : ''

  const showSourcesDefault = options.displayDefaults?.showSources ?? true
  const showSources = typeof data.showSources === 'boolean' ? data.showSources : showSourcesDefault
  const showTagsDefault = options.displayDefaults?.showTags ?? true
  const showTags = typeof data.showTags === 'boolean' ? data.showTags : showTagsDefault
  const sourcesText = showSources ? formatSources(data.sources) : undefined
  const tagsText = showTags ? formatTags(data.tags) : undefined
  const footerLines = [detailLine(translate('Common.Source'), sourcesText), detailLine(translate('Common.Tags'), tagsText)]
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
    detailLine(translate('Common.Weight'), formatWeight(itemData.weight, options.measurement)),
    detailLine(translate('Common.Value'), formatValue(itemData)),
    detailLine(translate('Common.Damage'), formatDamage(itemData)),
    detailLine(translate('Item.Mastery'), formatMastery(itemData)),
    detailLine(translate('Common.Range'), formatItemRange(itemData)),
    detailLine(translate('Item.Properties'), formatProperties(itemData)),
    detailLine(translate('Common.AC'), formatArmorClass(itemData)),
    detailLine(translate('Item.STRRequirement'), formatStrRequirement(itemData)),
    flagLineHtml(formatStealthFlag(itemData)),
    flagLineHtml(formatAttunementFlag(itemData)),
    detailLine(translate('Item.ContainerCapacity'), formatContainerCapacity(itemData, options.measurement)),
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
