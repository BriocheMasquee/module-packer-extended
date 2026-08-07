import { parse as parseYaml } from 'yaml'
import type { MarkdownIt } from 'markdown-it'
import { isNonEmptyString, isPlainObject, type ValidationIssue } from './compendiumShared.js'
import { validateBackgroundData } from './backgroundCompendium.js'
import { translate, type RenderLocale, type CatalogOverrides } from './catalog.js'
import { escapeHtml, resourceImagePath, formatSources, formatTags, labelSeparator } from './compendiumBlock.js'
import type { MeasurementSystem, ContentLanguage } from './localization.js'

export const BACKGROUND_META_FIELDS = [
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
export const BACKGROUND_DATA_FIELDS = ['abilities', 'feat', 'skills', 'tools', 'equipment'] as const

/** Inline ```background` YAML is written flat (no `data:` wrapper) for ease
 * of authoring — this reshapes it into the same { name, slug, data, ... }
 * shape standalone background files use, so the same validateBackgroundData
 * applies to both. */
export function normalizeInlineBackground(raw: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const field of BACKGROUND_META_FIELDS) {
    if (raw[field] !== undefined) {
      normalized[field] = raw[field]
    }
  }
  const data: Record<string, unknown> = {}
  for (const field of BACKGROUND_DATA_FIELDS) {
    if (raw[field] !== undefined) {
      data[field] = raw[field]
    }
  }
  if (Object.keys(data).length > 0) {
    normalized.data = data
  }
  return normalized
}

export interface ParsedBackgroundBlock {
  data: Record<string, unknown>
  issues: ValidationIssue[]
}

const INLINE_BACKGROUND_FILE_LABEL = 'inline background block'

/** See the identical hint in itemBlock.ts/spellBlock.ts — same cause (a
 * previous ```background block missing its closing ``` line), just for
 * background blocks instead. */
const UNCLOSED_FENCE_HINT =
  ' A previous ```background block above this one is likely missing its closing ``` line — check that it ends with its own ``` before this block starts.'

export function parseBackgroundBlock(yamlSource: string): ParsedBackgroundBlock {
  const issues: ValidationIssue[] = []
  let raw: unknown
  try {
    raw = parseYaml(yamlSource)
  } catch (error) {
    const hint = /^\s*```/m.test(yamlSource) ? UNCLOSED_FENCE_HINT : ''
    return {
      data: {},
      issues: [{ file: INLINE_BACKGROUND_FILE_LABEL, message: `Invalid YAML: ${(error as Error).message}${hint}` }],
    }
  }
  if (!isPlainObject(raw)) {
    return { data: {}, issues: [{ file: INLINE_BACKGROUND_FILE_LABEL, message: 'Must be a YAML mapping (key: value pairs).' }] }
  }

  const data = normalizeInlineBackground(raw)
  if (!isNonEmptyString(data.name)) {
    issues.push({ file: INLINE_BACKGROUND_FILE_LABEL, message: 'Must contain a non-empty name.' })
  }
  validateBackgroundData(INLINE_BACKGROUND_FILE_LABEL, data.data, issues)
  return { data, issues }
}

/** `str`/`dex`/... -> the catalog's full-word `Ability.*` key (e.g.
 * `Ability.Strength`) — background shows the full ability name ("Valeurs de
 * caractéristique. Intelligence, Sagesse, Charisme"), unlike a monster's
 * stat block, which shows the short abbreviation instead (`Ability.STR`).
 * A custom (non-standard) ability value passes through untranslated. */
const ABILITY_FULL_NAMES: Record<string, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
}

function translateAbility(value: string, locale: RenderLocale): string {
  const fullName = ABILITY_FULL_NAMES[value]
  return fullName ? translate(`Ability.${fullName}`, locale.language, locale.overrides) : value
}

/** `Skill.SleightofHand` is the one irregular catalog key (lowercase "of",
 * not "SleightOfHand" like every other camelCase key would naively
 * PascalCase to) — same quirk documented in monsterBlock.ts's own
 * translateEnum. A custom (non-standard) skill value passes through
 * untranslated. */
const KNOWN_SKILLS = new Set([
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
])

function translateSkill(value: string, locale: RenderLocale): string {
  if (!KNOWN_SKILLS.has(value)) {
    return value
  }
  if (value === 'sleightOfHand') {
    return translate('Skill.SleightofHand', locale.language, locale.overrides)
  }
  const pascalKey = value.charAt(0).toUpperCase() + value.slice(1)
  return translate(`Skill.${pascalKey}`, locale.language, locale.overrides)
}

/** "A, B and C" / "A, B et C" — the real official book style for a joined
 * trait list (no Oxford comma, last item joined with the language's own
 * conjunction), distinct from how a monster's `languages` always joins
 * with a plain `, ` regardless of position. Uses the platform's own
 * `Intl.ListFormat` rather than a hardcoded "and"/"et" so the comma/
 * conjunction placement follows real locale rules. */
function formatConjunctionList(items: string[], language: ContentLanguage): string | undefined {
  if (items.length === 0) {
    return undefined
  }
  const locale = language === 'fr' ? 'fr' : 'en'
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items)
}

/** Plain `, `-joined, no conjunction — confirmed against a real
 * EncounterPlus-rendered card: "Intelligence, Wisdom, Charisma", never
 * "...and Charisma" the way `Skill Proficiencies`/`Tool Proficiencies`
 * do (see formatConjunctionList). Ability Scores is the one detail line
 * that doesn't get the "and"/"et" treatment. */
function formatAbilities(data: Record<string, unknown>, locale: RenderLocale): string | undefined {
  const abilities = Array.isArray(data.abilities) ? data.abilities.filter((entry): entry is string => typeof entry === 'string') : []
  if (abilities.length === 0) {
    return undefined
  }
  return abilities.map((ability) => translateAbility(ability, locale)).join(', ')
}

function formatSkills(data: Record<string, unknown>, locale: RenderLocale): string | undefined {
  const skills = Array.isArray(data.skills) ? data.skills.filter((entry): entry is string => typeof entry === 'string') : []
  return formatConjunctionList(
    skills.map((skill) => translateSkill(skill, locale)),
    locale.language,
  )
}

function formatTools(data: Record<string, unknown>, locale: RenderLocale): string | undefined {
  const tools = Array.isArray(data.tools) ? data.tools.filter((entry): entry is string => typeof entry === 'string') : []
  return formatConjunctionList(tools, locale.language)
}

function formatFeat(data: Record<string, unknown>): string | undefined {
  return isNonEmptyString(data.feat) ? data.feat : undefined
}

/** Project-level fallback for each `show*` toggle, used only when a
 * background's own YAML leaves the field absent — an explicit `true`/
 * `false` in the background always wins over this default, same pattern as
 * item's own ItemDisplayDefaults. No icon toggles: a background has no
 * theme-provided icon set, same as item. */
export interface BackgroundDisplayDefaults {
  showImage?: boolean
  showSources?: boolean
  showTags?: boolean
}

export interface BackgroundBlockRenderOptions {
  measurement: MeasurementSystem
  language?: ContentLanguage
  overrides?: CatalogOverrides
  preview?: boolean
  displayDefaults?: BackgroundDisplayDefaults
}

/** Renders a parsed inline background (or a standalone background record,
 * same shape) into the `.compendium-block` markup the theme's CSS already
 * styles — shared with item/spell. Unlike item/spell's colon-separated
 * detail lines ("Weight: 3 lb"), a background's own detail lines use the
 * real official book's run-in-header style ("Ability Scores. Intelligence,
 * Wisdom, Charisma"), a bold label ending in a period rather than a colon
 * — `.compendium-block-detail-label` is already bold in the theme CSS,
 * only the separator differs, so the existing classes are reused as-is
 * with a different separator string. `Ability Scores` joins with a plain
 * comma (no "and"/"et"), unlike `Skill Proficiencies`/`Tool Proficiencies`
 * (see formatConjunctionList) — confirmed against a real
 * EncounterPlus-rendered card. `data.feat`/`data.tools`/`data.equipment`
 * support Markdown (real EncounterPlus data embeds links like
 * `[Calligrapher's Supplies](/item/...)` in these fields), rendered
 * inline like the other detail values but through the Markdown renderer
 * instead of escaped text — `data.skills` doesn't, since its values are
 * translated catalog labels, never authored free text. Image renders
 * right after the description, before the Source/Tags footer — the outer
 * div also carries a `compendium-block-background` class alongside the
 * shared `compendium-block` one, so a theme can style background's
 * title/detail lines/image differently from item/spell's
 * identical-looking card without affecting them. */
export function renderBackgroundBlockHtml(
  data: Record<string, unknown>,
  markdown: MarkdownIt,
  options: BackgroundBlockRenderOptions,
): string {
  const locale: RenderLocale = {
    measurement: options.measurement,
    language: options.language ?? 'en',
    overrides: options.overrides,
  }
  const name = isNonEmptyString(data.name) ? data.name : 'Unnamed Background'
  const backgroundData = isPlainObject(data.data) ? data.data : {}

  // Background's own detail lines use the real official book's run-in-
  // header style (a bold label ending in a period, e.g. "Ability Scores.
  // Intelligence, Wisdom, and Charisma"), not item/spell/monster's
  // colon-separated "Label: value" — but the Source/Tags footer still uses
  // the shared colon style below, for visual consistency with every other
  // Compendium block type's own footer.
  const detailLine = (label: string, valueHtml: string | undefined): string => {
    if (!valueHtml) {
      return ''
    }
    return `<p class="compendium-block-detail"><span class="compendium-block-detail-label">${escapeHtml(label)}. </span><span class="compendium-block-detail-value">${valueHtml}</span></p>`
  }
  const escapedDetailLine = (label: string, value: string | undefined): string =>
    value ? detailLine(label, escapeHtml(value)) : ''
  // Feat/Tools/Equipment support Markdown — real EncounterPlus data embeds
  // links like `[Calligrapher's Supplies](/item/...)` in these fields.
  const markdownDetailLine = (label: string, value: string | undefined): string =>
    value ? detailLine(label, markdown.renderInline(value)) : ''
  const footerDetailLine = (label: string, value: string | undefined): string => {
    if (!value) {
      return ''
    }
    return `<p class="compendium-block-detail"><span class="compendium-block-detail-label">${escapeHtml(label)}${labelSeparator(locale.language)}</span><span class="compendium-block-detail-value">${escapeHtml(value)}</span></p>`
  }

  const equipment = isNonEmptyString(backgroundData.equipment) ? backgroundData.equipment : undefined
  const descriptionHtml = isNonEmptyString(data.descr) ? `<div class="compendium-block-description">${markdown.render(data.descr)}</div>` : ''

  // "backgrounds/" (no file name) is the snippet's own untouched
  // placeholder, matching how a standalone background file treats that
  // same value as "no image set" rather than a literal (broken) path to
  // render.
  const hasImage = isNonEmptyString(data.image) && data.image !== 'backgrounds/'
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
  const footerLines = [
    footerDetailLine(translate('Common.Source', locale.language, locale.overrides), sourcesText),
    footerDetailLine(translate('Common.Tags', locale.language, locale.overrides), tagsText),
  ]
    .filter(Boolean)
    .join('')
  const footerHtml = footerLines ? `<div class="compendium-block-details compendium-block-details-footer">${footerLines}</div>` : ''

  return [
    '<div class="compendium-block compendium-block-background">',
    '<div class="compendium-block-top-border"></div>',
    `<div class="compendium-block-title">${escapeHtml(name)}</div>`,
    '<div class="compendium-block-body">',
    '<div class="compendium-block-details">',
    escapedDetailLine(translate('Background.AbilityScores', locale.language, locale.overrides), formatAbilities(backgroundData, locale)),
    markdownDetailLine(translate('Entity.Feat', locale.language, locale.overrides), formatFeat(backgroundData)),
    escapedDetailLine(translate('Background.SkillProficiencies', locale.language, locale.overrides), formatSkills(backgroundData, locale)),
    markdownDetailLine(translate('Background.ToolProficiencies', locale.language, locale.overrides), formatTools(backgroundData, locale)),
    markdownDetailLine(translate('Background.Equipment', locale.language, locale.overrides), equipment),
    '</div>',
    descriptionHtml,
    imageHtml,
    footerHtml,
    '</div>',
    '</div>',
  ]
    .filter(Boolean)
    .join('')
}
