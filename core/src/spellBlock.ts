import { parse as parseYaml } from 'yaml'
import type { MarkdownIt } from 'markdown-it'
import { isNonEmptyString, isPlainObject, type ValidationIssue } from './compendiumShared.js'
import { validateSpellData } from './spellCompendium.js'
import { translate, pluralize } from './catalogEn.js'
import { escapeHtml, themeAssetPath, formatSources, formatTags } from './compendiumBlock.js'
import type { MeasurementSystem } from './localization.js'

const SPELL_META_FIELDS = [
  'id',
  'name',
  'slug',
  'attributes',
  'descr',
  'image',
  'showImage',
  'showSchoolIcon',
  'showAreaEffectIcon',
  'sources',
  'showSources',
  'tags',
  'showTags',
] as const
const SPELL_DATA_FIELDS = [
  'level',
  'school',
  'ritual',
  'activation',
  'rangeType',
  'range',
  'areaEffectShape',
  'areaEffectSize',
  'components',
  'componentsDetail',
  'durationType',
  'duration',
  'durationUnit',
  'classes',
] as const

/** Inline ````spell` YAML is written flat (no `data:` wrapper) for ease of
 * authoring — this reshapes it into the same { name, slug, data, ... } shape
 * standalone spell files use, so the same validateSpellData applies to both. */
export function normalizeInlineSpell(raw: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const field of SPELL_META_FIELDS) {
    if (raw[field] !== undefined) {
      normalized[field] = raw[field]
    }
  }
  const data: Record<string, unknown> = {}
  for (const field of SPELL_DATA_FIELDS) {
    if (raw[field] !== undefined) {
      data[field] = raw[field]
    }
  }
  if (Object.keys(data).length > 0) {
    normalized.data = data
  }
  return normalized
}

export interface ParsedSpellBlock {
  data: Record<string, unknown>
  issues: ValidationIssue[]
}

const INLINE_SPELL_FILE_LABEL = 'inline spell block'

/** A bare ``` line inside what should be pure YAML almost always means a
 * *previous* ```spell block above this one was never closed — its content
 * swallowed everything up to (and past) this block's own opening fence,
 * which markdown-it then hands to us as literal YAML text. The resulting
 * parse error is technically accurate but meaningless to point at ("Implicit
 * keys need to be on a single line") without this hint. */
const UNCLOSED_FENCE_HINT =
  ' A previous ```spell block above this one is likely missing its closing ``` line — check that it ends with its own ``` before this block starts.'

export function parseSpellBlock(yamlSource: string): ParsedSpellBlock {
  const issues: ValidationIssue[] = []
  let raw: unknown
  try {
    raw = parseYaml(yamlSource)
  } catch (error) {
    const hint = /^\s*```/m.test(yamlSource) ? UNCLOSED_FENCE_HINT : ''
    return { data: {}, issues: [{ file: INLINE_SPELL_FILE_LABEL, message: `Invalid YAML: ${(error as Error).message}${hint}` }] }
  }
  if (!isPlainObject(raw)) {
    return { data: {}, issues: [{ file: INLINE_SPELL_FILE_LABEL, message: 'Must be a YAML mapping (key: value pairs).' }] }
  }

  const data = normalizeInlineSpell(raw)
  if (!isNonEmptyString(data.name)) {
    issues.push({ file: INLINE_SPELL_FILE_LABEL, message: 'Must contain a non-empty name.' })
  }
  validateSpellData(INLINE_SPELL_FILE_LABEL, data.data, issues)
  return { data, issues }
}

/** Catalog keys follow a simple `{Namespace}.{PascalCase(enumKey)}` pattern
 * (confirmed against every enum in the real EncounterPlus catalog: e.g.
 * `meleeWeapon` -> `ItemType.MeleeWeapon`, `dispelOrTrigger` ->
 * `SpellDuration.DispelOrTrigger`) — capitalizing just the first letter of
 * the camelCase key always lands on the right catalog entry. */
function translateEnum(namespace: string, enumKey: string): string {
  const pascalKey = enumKey.charAt(0).toUpperCase() + enumKey.slice(1)
  return translate(`${namespace}.${pascalKey}`)
}

function formatHeading(data: Record<string, unknown>): string | undefined {
  const level = typeof data.level === 'number' ? data.level : undefined
  const school = isNonEmptyString(data.school) ? data.school : undefined
  const schoolLabel = school ? translateEnum('SpellSchool', school) : undefined
  const classes = Array.isArray(data.classes)
    ? data.classes.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.split('|')[0])
    : []

  const parts: string[] = []
  if (level === 0 && schoolLabel) {
    parts.push(`${schoolLabel} ${translate('SpellLevel.Cantrip')}`)
  } else if (level !== undefined && schoolLabel) {
    parts.push(`${translate('Common.Level')} ${level} ${schoolLabel}`)
  } else if (schoolLabel) {
    parts.push(schoolLabel)
  } else if (level !== undefined) {
    parts.push(`${translate('Common.Level')} ${level}`)
  }
  if (classes.length > 0) {
    parts.push(`(${classes.join(', ')})`)
  }
  return parts.length > 0 ? parts.join(' ') : undefined
}

function formatCastingTime(data: Record<string, unknown>): string | undefined {
  const activation = isPlainObject(data.activation) ? data.activation : undefined
  const unit = isNonEmptyString(activation?.unit) ? activation.unit : undefined
  const time = typeof activation?.time === 'number' ? activation.time : undefined

  let text: string | undefined
  if (unit === 'action' || unit === 'bonusAction' || unit === 'reaction') {
    text = translateEnum('ActivationUnit', unit)
  } else if (unit === 'hour' || unit === 'minute') {
    const count = time ?? 1
    text = `${count} ${pluralize(`Unit.${unit === 'hour' ? 'Hour' : 'Minute'}`, count)}`
  }
  if (text && data.ritual === true) {
    text += ` or ${translate('Spell.Ritual')}`
  }
  return text
}

/** Values are always authored in feet (matching D&D's own rules) — metric
 * display converts using the same simplified factor as WotC's own licensed
 * French translations (feet × 0.3, rounded to the nearest half-unit), not
 * the precise 0.3048 metric conversion. */
const FEET_TO_METERS_FACTOR = 0.3

function feetToDisplayValue(feet: number, measurement: MeasurementSystem): number {
  return measurement === 'metric' ? Math.round(feet * FEET_TO_METERS_FACTOR * 2) / 2 : feet
}

function formatDistanceNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatRange(data: Record<string, unknown>, measurement: MeasurementSystem): string | undefined {
  const rangeType = isNonEmptyString(data.rangeType) ? data.rangeType : undefined
  if (rangeType) {
    return translateEnum('SpellRange', rangeType)
  }
  // 0 is never a real spell range in D&D's rules — treated as "not set"
  // (matching the snippet's own placeholder default), not a literal 0 feet.
  if (typeof data.range === 'number' && data.range > 0) {
    const value = formatDistanceNumber(feetToDisplayValue(data.range, measurement))
    return `${value} ${measurement === 'metric' ? 'meters' : 'feet'}`
  }
  return undefined
}

/** File names confirmed against the theme's own bundled icon assets
 * (converted/renamed from the user's source PNGs, plus a freshly-authored
 * square icon — square and cube are distinct EncounterPlus shapes). */
const SCHOOL_ICON_FILES: Record<string, string> = {
  abjuration: 'school-abjuration.webp',
  conjuration: 'school-conjuration.webp',
  divination: 'school-divination.webp',
  enchantment: 'school-enchantment.webp',
  evocation: 'school-evocation.webp',
  illusion: 'school-illusion.webp',
  necromancy: 'school-necromancy.webp',
  transmutation: 'school-transmutation.webp',
}
const SHAPE_ICON_FILES: Record<string, string> = {
  cone: 'shape-cone.webp',
  cube: 'shape-cube.webp',
  cylinder: 'shape-cylinder.webp',
  emanation: 'shape-emanation.webp',
  line: 'shape-line.webp',
  sphere: 'shape-sphere.webp',
  square: 'shape-square.webp',
}

/** The shape icon, or (when disabled, or no icon file exists for that
 * shape) the shape's translated text label instead — the parenthetical
 * always shows something, never leaves a dangling empty spot. */
function formatAreaEffectShapeHtml(shape: string | undefined, showIcon: boolean, preview: boolean | undefined): string {
  if (!shape) {
    return ''
  }
  const file = showIcon ? SHAPE_ICON_FILES[shape] : undefined
  if (file) {
    const alt = escapeHtml(translateEnum('AreaEffectShape', shape))
    return `<img class="spell-block-shape-icon" src="${escapeHtml(themeAssetPath(file, preview))}" alt="${alt}">`
  }
  return escapeHtml(translateEnum('AreaEffectShape', shape))
}

/** Range and area effect render as a single detail line — EncounterPlus
 * appends the area size/shape in parentheses after the range value rather
 * than giving it its own line (confirmed against a real rendered spell). */
function buildRangeDetailHtml(
  spellData: Record<string, unknown>,
  measurement: MeasurementSystem,
  showAreaEffectIcon: boolean,
  preview: boolean | undefined,
): string {
  const rangeText = formatRange(spellData, measurement)
  const areaShape = isNonEmptyString(spellData.areaEffectShape) ? spellData.areaEffectShape : undefined
  // 0 is never a real area effect size — treated as "not set" (matching the
  // snippet's own placeholder default), not a literal 0 ft/m.
  const areaSize =
    typeof spellData.areaEffectSize === 'number' && spellData.areaEffectSize > 0 ? spellData.areaEffectSize : undefined
  const hasArea = areaShape !== undefined || areaSize !== undefined
  if (!rangeText && !hasArea) {
    return ''
  }

  let value = rangeText ? escapeHtml(rangeText) : ''
  if (hasArea) {
    const sizeText =
      areaSize !== undefined
        ? `${formatDistanceNumber(feetToDisplayValue(areaSize, measurement))} ${measurement === 'metric' ? 'm' : 'ft'} `
        : ''
    value += ` (${escapeHtml(sizeText)}${formatAreaEffectShapeHtml(areaShape, showAreaEffectIcon, preview)})`
  }
  return `<p class="compendium-block-detail"><span class="compendium-block-detail-label">${escapeHtml(translate('Common.Range'))}: </span><span class="compendium-block-detail-value">${value}</span></p>`
}

function formatComponents(data: Record<string, unknown>): string | undefined {
  const components = Array.isArray(data.components)
    ? data.components.filter((entry): entry is string => typeof entry === 'string')
    : []
  if (components.length === 0) {
    return undefined
  }
  const detail = isNonEmptyString(data.componentsDetail) ? ` (${data.componentsDetail})` : ''
  return `${components.join(', ')}${detail}`
}

function formatDuration(data: Record<string, unknown>): string | undefined {
  const durationType = isNonEmptyString(data.durationType) ? data.durationType : undefined
  const duration = typeof data.duration === 'number' ? data.duration : undefined
  const durationUnit = isNonEmptyString(data.durationUnit) ? data.durationUnit : undefined
  const durationUnitText = (unit: string, count: number): string => `${count} ${pluralize(`Unit.${unit.charAt(0).toUpperCase() + unit.slice(1)}`, count)}`

  if (!durationType) {
    return duration !== undefined && durationUnit ? durationUnitText(durationUnit, duration) : undefined
  }
  if (durationType === 'concentration') {
    const base = translate('SpellDuration.Concentration')
    if (duration !== undefined && durationUnit) {
      return `${base}, ${translate('Spell.UpTo')} ${durationUnitText(durationUnit, duration)}`
    }
    return base
  }
  return translateEnum('SpellDuration', durationType)
}

/** Project-level fallback for each `show*` toggle, used only when a spell's
 * own YAML leaves the field absent — an explicit `true`/`false` in the spell
 * always wins over this default, matching how attributes.measurement/ruleset
 * already work. All default to `true` (today's hardcoded behavior). */
export interface SpellDisplayDefaults {
  showImage?: boolean
  showSchoolIcon?: boolean
  showAreaEffectIcon?: boolean
  showSources?: boolean
  showTags?: boolean
}

export interface SpellBlockRenderOptions {
  measurement: MeasurementSystem
  preview?: boolean
  displayDefaults?: SpellDisplayDefaults
}

/** Renders a parsed inline spell (or a standalone spell record, same shape)
 * into the `.compendium-block` markup the 5.5e theme's CSS already styles. */
export function renderSpellBlockHtml(
  data: Record<string, unknown>,
  markdown: MarkdownIt,
  options: SpellBlockRenderOptions,
): string {
  const name = isNonEmptyString(data.name) ? data.name : 'Unnamed Spell'
  const spellData = isPlainObject(data.data) ? data.data : {}

  const detailLine = (label: string, value: string | undefined): string => {
    if (!value) {
      return ''
    }
    return `<p class="compendium-block-detail"><span class="compendium-block-detail-label">${escapeHtml(label)}: </span><span class="compendium-block-detail-value">${escapeHtml(value)}</span></p>`
  }

  const heading = formatHeading(spellData)
  const descriptionHtml = isNonEmptyString(data.descr)
    ? `<div class="compendium-block-description">${markdown.render(data.descr)}</div>`
    : ''

  // "spells/" (no file name) is the snippet's own untouched placeholder,
  // matching how a standalone spell file treats that same value as "no
  // image set" rather than a literal (broken) path to render.
  const hasImage = isNonEmptyString(data.image) && data.image !== 'spells/'
  const showImageDefault = options.displayDefaults?.showImage ?? true
  const showImage = (typeof data.showImage === 'boolean' ? data.showImage : showImageDefault) && hasImage
  const imageHtml = showImage
    ? `<div class="compendium-image-block"><img class="compendium-image" src="${escapeHtml(String(data.image))}" alt=""></div>`
    : ''

  const showSchoolIconDefault = options.displayDefaults?.showSchoolIcon ?? true
  const showSchoolIcon = typeof data.showSchoolIcon === 'boolean' ? data.showSchoolIcon : showSchoolIconDefault
  const school = isNonEmptyString(spellData.school) ? spellData.school : undefined
  const schoolIconFile = showSchoolIcon && school ? SCHOOL_ICON_FILES[school] : undefined
  const schoolIconHtml = schoolIconFile
    ? `<img class="spell-block-school-icon" src="${escapeHtml(themeAssetPath(schoolIconFile, options.preview))}" alt="${escapeHtml(translateEnum('SpellSchool', school as string))}">`
    : ''

  const showAreaEffectIconDefault = options.displayDefaults?.showAreaEffectIcon ?? true
  const showAreaEffectIcon =
    typeof data.showAreaEffectIcon === 'boolean' ? data.showAreaEffectIcon : showAreaEffectIconDefault

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
    imageHtml,
    schoolIconHtml,
    '<div class="compendium-block-top-border"></div>',
    `<div class="compendium-block-title">${escapeHtml(name)}</div>`,
    heading ? `<div class="compendium-block-heading">${escapeHtml(heading)}</div>` : '',
    '<div class="compendium-block-body">',
    '<div class="compendium-block-details">',
    detailLine(translate('Spell.CastingTime'), formatCastingTime(spellData)),
    buildRangeDetailHtml(spellData, options.measurement, showAreaEffectIcon, options.preview),
    detailLine(translate('Spell.Components'), formatComponents(spellData)),
    detailLine(translate('Spell.Duration'), formatDuration(spellData)),
    '</div>',
    descriptionHtml,
    footerHtml,
    '</div>',
    '</div>',
  ]
    .filter(Boolean)
    .join('')
}
