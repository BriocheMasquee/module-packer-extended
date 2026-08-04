import { parse as parseYaml } from 'yaml'
import type { MarkdownIt } from 'markdown-it'
import { isNonEmptyString, isPlainObject, type ValidationIssue } from './compendiumShared.js'
import { validateMonsterData, MONSTER_ABILITY_KEYS, MONSTER_FEATURE_LIST_FIELDS } from './monsterCompendium.js'
import { translate, type RenderLocale, type CatalogOverrides } from './catalog.js'
import {
  escapeHtml,
  resourceImagePath,
  feetToDisplayValue,
  formatDistanceNumber,
  formatSources,
  formatTags,
  labelSeparator,
} from './compendiumBlock.js'
import type { MeasurementSystem, ContentLanguage } from './localization.js'

export const MONSTER_META_FIELDS = [
  'id',
  'name',
  'slug',
  'attributes',
  'descr',
  'image',
  'showImage',
  'token',
  'showToken',
  'sources',
  'showSources',
  'tags',
  'showTags',
] as const
export const MONSTER_DATA_FIELDS = [
  'size',
  'type',
  'typeDetail',
  'alignment',
  'ac',
  'hp',
  'speed',
  'abilities',
  'savingThrows',
  'skills',
  'conditionImmunities',
  'damageImmunities',
  'damageResistances',
  'damageVulnerabilities',
  'senses',
  'passivePerception',
  'languages',
  'cr',
  'initiativeBonus',
  'proficiencyBonus',
  'environments',
  ...MONSTER_FEATURE_LIST_FIELDS,
] as const

/** Inline ```monster` YAML is written flat (no `data:` wrapper) for ease of
 * authoring — this reshapes it into the same { name, slug, data, ... } shape
 * standalone monster files use, so the same validateMonsterData applies to
 * both. `color`/`twoColumn` stay at the top level (meta), not in `data` —
 * they're presentation-only, not part of EncounterPlus's own schema. */
export function normalizeInlineMonster(raw: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const field of MONSTER_META_FIELDS) {
    if (raw[field] !== undefined) {
      normalized[field] = raw[field]
    }
  }
  const data: Record<string, unknown> = {}
  for (const field of MONSTER_DATA_FIELDS) {
    if (raw[field] !== undefined) {
      data[field] = raw[field]
    }
  }
  if (Object.keys(data).length > 0) {
    normalized.data = data
  }
  return normalized
}

export interface ParsedMonsterBlock {
  data: Record<string, unknown>
  issues: ValidationIssue[]
}

const INLINE_MONSTER_FILE_LABEL = 'inline monster block'

/** See the identical hint in spellBlock.ts — same cause (a previous
 * ```monster block missing its closing ``` line), just for monster blocks. */
const UNCLOSED_FENCE_HINT =
  ' A previous ```monster block above this one is likely missing its closing ``` line — check that it ends with its own ``` before this block starts.'

export function parseMonsterBlock(yamlSource: string): ParsedMonsterBlock {
  const issues: ValidationIssue[] = []
  let raw: unknown
  try {
    raw = parseYaml(yamlSource)
  } catch (error) {
    const hint = /^\s*```/m.test(yamlSource) ? UNCLOSED_FENCE_HINT : ''
    return { data: {}, issues: [{ file: INLINE_MONSTER_FILE_LABEL, message: `Invalid YAML: ${(error as Error).message}${hint}` }] }
  }
  if (!isPlainObject(raw)) {
    return { data: {}, issues: [{ file: INLINE_MONSTER_FILE_LABEL, message: 'Must be a YAML mapping (key: value pairs).' }] }
  }

  const data = normalizeInlineMonster(raw)
  if (!isNonEmptyString(data.name)) {
    issues.push({ file: INLINE_MONSTER_FILE_LABEL, message: 'Must contain a non-empty name.' })
  }
  validateMonsterData(INLINE_MONSTER_FILE_LABEL, data.data, issues)
  return { data, issues }
}

/** Catalog keys follow `{Namespace}.{PascalCase(enumKey)}` — same pattern
 * used for spell/item enums. Two exceptions in the real catalog:
 * `Skill.SleightofHand` (lowercase "of", not "SleightOfHand" like every
 * other camelCase key would naively PascalCase to), and `Ability.*` keys
 * which are the short all-caps abbreviations (`STR`, `DEX`, ...), not
 * PascalCase words. */
function translateEnum(namespace: string, enumKey: string, locale: RenderLocale): string {
  if (namespace === 'Skill' && enumKey === 'sleightOfHand') {
    return translate('Skill.SleightofHand', locale.language, locale.overrides)
  }
  if (namespace === 'Ability') {
    return translate(`Ability.${enumKey.toUpperCase()}`, locale.language, locale.overrides)
  }
  const pascalKey = enumKey.charAt(0).toUpperCase() + enumKey.slice(1)
  return translate(`${namespace}.${pascalKey}`, locale.language, locale.overrides)
}

const SIZE_WORDS: Record<string, string> = {
  T: 'Tiny',
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  H: 'Huge',
  G: 'Gargantuan',
  C: 'Colossal',
}

const ALIGNMENT_WORDS: Record<string, string> = {
  LG: 'LawfulGood',
  NG: 'NeutralGood',
  CG: 'ChaoticGood',
  LN: 'LawfulNeutral',
  NN: 'Neutral',
  CN: 'ChaoticNeutral',
  LE: 'LawfulEvil',
  NE: 'NeutralEvil',
  CE: 'ChaoticEvil',
  UU: 'Unaligned',
}

/** The real French SRD shows size as a letter code, not the spelled-out
 * catalog word (e.g. "de taille G", never "de taille Grande") — confirmed
 * against several real stat blocks. "C" (Colossal) has no French code:
 * it isn't a real 5.5e size, so it's left unmapped rather than guessed.
 * Not sourced from the EncounterPlus catalog (it has no letter-code data),
 * so kept as its own table. */
const FR_SIZE_LETTERS: Record<string, string> = {
  T: 'TP',
  S: 'P',
  M: 'M',
  L: 'G',
  H: 'TG',
  G: 'Gig',
}

/** French grammatical gender of each monster type's own translated noun
 * (e.g. "Monstruosité"/"Plante" are feminine, "Mort-vivant"/"Fiélon" are
 * masculine) — used to pick the alignment adjectives' gendered form.
 * Confirmed against real 5.5e French SRD stat blocks (Merrow: "Monstruosité
 * ... Chaotique Mauvaise"; Nalfeshnie: "Fiélon ... Chaotique Mauvais"; Liche:
 * "Mort-vivant ... Neutre Mauvais"; Tarasque: "Monstruosité ... non
 * alignée"). Not sourced from the EncounterPlus catalog (it has no gender
 * data), so kept as its own table. */
const MONSTER_TYPE_FEMININE: Record<string, boolean> = {
  aberration: true,
  beast: true,
  fey: true,
  monstrosity: true,
  ooze: true,
  plant: true,
  celestial: false,
  construct: false,
  dragon: false,
  elemental: false,
  fiend: false,
  giant: false,
  humanoid: false,
  undead: false,
}

/** Feminizes the catalog's fixed-masculine French alignment string —
 * "Loyal"/"Bon"/"Mauvais"/"aligné" each have a distinct feminine form
 * ("Loyale"/"Bonne"/"Mauvaise"/"alignée"); "Chaotique"/"Neutre" don't
 * change. Confirmed against real French SRD stat blocks (see
 * MONSTER_TYPE_FEMININE). Post-processes the catalog value instead of
 * duplicating the whole alignment table, since the masculine form is
 * already correct EncounterPlus catalog data. */
function feminizeFrenchAlignment(masculine: string): string {
  return masculine
    .replace(/\bLoyal\b/, 'Loyale')
    .replace(/\bBon\b/, 'Bonne')
    .replace(/\bMauvais\b/, 'Mauvaise')
    .replace(/\baligné\b/, 'alignée')
}

/** "Large Fey, Neutral Evil" in English. French reverses the word order
 * ("Fey (detail) de taille G, Chaotique Mauvaise" — type before size, "de
 * taille" before the size letter) and gender-agrees the alignment with the
 * monster type — confirmed against several real 5.5e French SRD stat
 * blocks (see FR_SIZE_LETTERS/MONSTER_TYPE_FEMININE above). */
function formatSubtitle(data: Record<string, unknown>, locale: RenderLocale): string | undefined {
  const rawType = isNonEmptyString(data.type) ? data.type : undefined
  const typeLabel = rawType ? translateEnum('MonsterType', rawType, locale) : undefined
  const typeDetail = isNonEmptyString(data.typeDetail) ? data.typeDetail : undefined
  const typePart = typeLabel ? (typeDetail ? `${typeLabel} (${typeDetail})` : typeLabel) : typeDetail
  const alignmentWord = isNonEmptyString(data.alignment) ? ALIGNMENT_WORDS[data.alignment] : undefined
  let alignmentLabel = alignmentWord ? translateEnum('Alignment', alignmentWord, locale) : undefined

  if (locale.language === 'fr') {
    if (alignmentLabel && rawType && MONSTER_TYPE_FEMININE[rawType]) {
      alignmentLabel = feminizeFrenchAlignment(alignmentLabel)
    }
    const sizeLetter = isNonEmptyString(data.size) ? FR_SIZE_LETTERS[data.size] : undefined
    const sizePart = sizeLetter ? `de taille ${sizeLetter}` : undefined
    const typeSizePart = [typePart, sizePart].filter((part): part is string => Boolean(part)).join(' ')
    const parts = [typeSizePart, alignmentLabel].filter((part): part is string => Boolean(part))
    return parts.length > 0 ? parts.join(', ') : undefined
  }

  const size = isNonEmptyString(data.size) ? SIZE_WORDS[data.size] : undefined
  const sizeLabel = size ? translateEnum('Size', size, locale) : undefined
  const sizeTypePart = [sizeLabel, typePart].filter((part): part is string => Boolean(part)).join(' ')
  const parts = [sizeTypePart, alignmentLabel].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(', ') : undefined
}

const SPEED_FIELDS = ['walk', 'burrow', 'climb', 'fly', 'swim'] as const

function formatFeetSuffix(value: number, measurement: MeasurementSystem): string {
  const displayValue = formatDistanceNumber(feetToDisplayValue(value, measurement))
  return `${displayValue} ${measurement === 'metric' ? 'm' : 'ft'}.`
}

/** "40 ft." or "10 ft., Swim 40 ft." — walk has no label of its own (it's
 * the implicit default speed); every other mode is labeled and only shown
 * when set. */
function formatSpeed(speed: unknown, locale: RenderLocale): string | undefined {
  if (!isPlainObject(speed)) {
    return undefined
  }
  const parts: string[] = []
  for (const field of SPEED_FIELDS) {
    const value = speed[field]
    if (typeof value !== 'number' || value <= 0) {
      continue
    }
    if (field === 'walk') {
      parts.push(formatFeetSuffix(value, locale.measurement))
    } else {
      const label = translateEnum('Movement', field, locale)
      const hover = field === 'fly' && speed.hover === true ? ` (${translate('Movement.Hover', locale.language, locale.overrides)})` : ''
      parts.push(`${label} ${formatFeetSuffix(value, locale.measurement)}${hover}`)
    }
  }
  if (isNonEmptyString(speed.other)) {
    parts.push(speed.other)
  }
  return parts.length > 0 ? parts.join(', ') : undefined
}

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2)
}

function formatSigned(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`
}

/** One `.statblock-ability-row` per ability — score/mod always shown
 * (defaulting an absent score to 10, the SRD baseline) once the abilities
 * table itself is present at all; save defaults to the modifier (matching
 * the non-proficient case) unless overridden in the sparse `savingThrows`
 * map. */
function abilityRowHtml(key: string, abilities: Record<string, unknown>, savingThrows: Record<string, unknown>, locale: RenderLocale): string {
  const score = typeof abilities[key] === 'number' ? abilities[key] : 10
  const mod = abilityModifier(score)
  const save = typeof savingThrows[key] === 'number' ? savingThrows[key] : mod
  const label = translateEnum('Ability', key, locale)
  return `<div class="statblock-ability-row"><strong>${escapeHtml(label)}</strong><span>${score}</span><span>${escapeHtml(formatSigned(mod))}</span><span>${escapeHtml(formatSigned(save))}</span></div>`
}

function abilitiesHtml(data: Record<string, unknown>, locale: RenderLocale): string {
  const abilities = isPlainObject(data.abilities) ? data.abilities : undefined
  if (!abilities) {
    return ''
  }
  const savingThrows = isPlainObject(data.savingThrows) ? data.savingThrows : {}
  const physical = MONSTER_ABILITY_KEYS.slice(0, 3)
  const mental = MONSTER_ABILITY_KEYS.slice(3, 6)
  const column = (keys: string[], columnClass: string): string =>
    `<div class="statblock-ability-column ${columnClass}">${keys.map((key) => abilityRowHtml(key, abilities, savingThrows, locale)).join('')}</div>`
  return `<div class="statblock-abilities">${column(physical, 'physical')}${column(mental, 'mental')}</div>`
}

function formatSkills(skills: unknown, locale: RenderLocale): string | undefined {
  if (!isPlainObject(skills)) {
    return undefined
  }
  const entries = Object.entries(skills).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
  if (entries.length === 0) {
    return undefined
  }
  return entries
    .map(([key, value]) => `${translateEnum('Skill', key, locale)} ${formatSigned(value)}`)
    .sort((a, b) => a.localeCompare(b))
    .join(', ')
}

function formatSavingThrows(data: Record<string, unknown>, locale: RenderLocale): string | undefined {
  const abilities = isPlainObject(data.abilities) ? data.abilities : undefined
  const savingThrows = isPlainObject(data.savingThrows) ? data.savingThrows : undefined
  if (!savingThrows) {
    return undefined
  }
  const entries = Object.entries(savingThrows).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
  if (entries.length === 0) {
    return undefined
  }
  // Saving throws are only worth listing separately when they diverge from
  // the plain ability modifier — otherwise it's exactly what the ability
  // table already shows.
  const divergent = entries.filter(([key, value]) => {
    const score = abilities && typeof abilities[key] === 'number' ? abilities[key] : 10
    return value !== abilityModifier(score)
  })
  if (divergent.length === 0) {
    return undefined
  }
  return divergent
    .map(([key, value]) => `${translateEnum('Ability', key, locale)} ${formatSigned(value)}`)
    .join(', ')
}

function formatDamageList(values: unknown, locale: RenderLocale): string | undefined {
  if (!Array.isArray(values)) {
    return undefined
  }
  const entries = values.filter((entry): entry is string => typeof entry === 'string')
  return entries.length > 0 ? entries.map((entry) => translateEnum('Damage', entry, locale)).join(', ') : undefined
}

function formatStringList(values: unknown): string | undefined {
  if (!Array.isArray(values)) {
    return undefined
  }
  const entries = values.filter((entry): entry is string => typeof entry === 'string')
  return entries.length > 0 ? entries.join(', ') : undefined
}

/** `languages` is free text (not enum-validated, see MONSTER_TYPE_FEMININE's
 * neighbors in the docs — a homebrew/setting-specific language must stay
 * typeable), but the catalog does have a `Language.*` entry for every
 * standard D&D language. Translated only when an exact match exists
 * (`translate()` returns the key itself when it doesn't — the signal a
 * custom value was typed); left exactly as authored otherwise. */
function formatLanguageList(values: unknown, locale: RenderLocale): string | undefined {
  if (!Array.isArray(values)) {
    return undefined
  }
  const entries = values.filter((entry): entry is string => typeof entry === 'string')
  if (entries.length === 0) {
    return undefined
  }
  return entries
    .map((entry) => {
      const key = `Language.${entry}`
      const translated = translate(key, locale.language, locale.overrides)
      return translated === key ? entry : translated
    })
    .join(', ')
}

const SENSE_FIELDS = ['blindsight', 'darkvision', 'tremorsense', 'truesight'] as const

function formatSenses(data: Record<string, unknown>, locale: RenderLocale): string | undefined {
  const senses = isPlainObject(data.senses) ? data.senses : undefined
  const parts: string[] = []
  if (senses) {
    for (const field of SENSE_FIELDS) {
      const value = senses[field]
      if (typeof value === 'number' && value > 0) {
        parts.push(`${translateEnum('Sense', field, locale)} ${formatFeetSuffix(value, locale.measurement)}`)
      }
    }
    if (isNonEmptyString(senses.other)) {
      parts.push(senses.other)
    }
  }
  if (typeof data.passivePerception === 'number') {
    parts.push(`${translate('Sense.PassivePerception', locale.language, locale.overrides)} ${data.passivePerception}`)
  }
  return parts.length > 0 ? parts.join('; ') : undefined
}

/** The standard 5e CR -> XP table — fixed and universal (unlike a specific
 * monster's "or X in lair" bonus XP, which isn't stored data we have and is
 * skipped here as an accepted gap, same spirit as item's missing Ability/
 * Utilize/Craft fields). Confirmed against three real stat blocks (CR 21 ->
 * 33,000; CR 10 -> 5,900; CR 6 -> 2,300). */
const CR_TO_XP: Record<string, number> = {
  '0': 10,
  '1/8': 25,
  '1/4': 50,
  '1/2': 100,
  '1': 200,
  '2': 450,
  '3': 700,
  '4': 1100,
  '5': 1800,
  '6': 2300,
  '7': 2900,
  '8': 3900,
  '9': 5000,
  '10': 5900,
  '11': 7200,
  '12': 8400,
  '13': 10000,
  '14': 11500,
  '15': 13000,
  '16': 15000,
  '17': 18000,
  '18': 20000,
  '19': 22000,
  '20': 25000,
  '21': 33000,
  '22': 41000,
  '23': 50000,
  '24': 62000,
  '25': 75000,
  '26': 90000,
  '27': 105000,
  '28': 120000,
  '29': 135000,
  '30': 155000,
}

function formatNumberWithCommas(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatChallenge(data: Record<string, unknown>, locale: RenderLocale): string | undefined {
  if (!isNonEmptyString(data.cr)) {
    return undefined
  }
  const xp = CR_TO_XP[data.cr]
  const proficiencyBonus = typeof data.proficiencyBonus === 'number' ? data.proficiencyBonus : undefined
  const details = [
    xp !== undefined ? `${translate('Common.XP', locale.language, locale.overrides)} ${formatNumberWithCommas(xp)}` : undefined,
    // No "PB" abbreviation key exists in the catalog (only the spelled-out
    // "Proficiency Bonus") — "PB" is a standard, widely-recognized D&D
    // abbreviation in its own right, not really "untranslated" content.
    proficiencyBonus !== undefined ? `PB ${formatSigned(proficiencyBonus)}` : undefined,
  ].filter((part): part is string => Boolean(part))
  return details.length > 0 ? `${data.cr} (${details.join('; ')})` : data.cr
}

/** `{name, text, usage?}` renders as `<name> (<usage>). <text>` — matching
 * the official book style (e.g. "Cold Breath (Recharge 5-6). ..."). */
/** camelCase -> kebab-case, matching the theme's CSS class names
 * (`.statblock-bonus-action`, `.statblock-legendary-action`, ...) — the
 * camelCase form is only used for the catalog lookup (`Monster.BonusActions`). */
function kebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

function featureListHtml(kind: string, entries: unknown, locale: RenderLocale): string {
  if (!Array.isArray(entries) || entries.length === 0) {
    return ''
  }
  const cssKind = kebabCase(kind)
  const items = entries
    .filter(isPlainObject)
    .map((entry) => {
      const name = isNonEmptyString(entry.name) ? entry.name : undefined
      const usage = isNonEmptyString(entry.usage) ? entry.usage : undefined
      const text = isNonEmptyString(entry.text) ? entry.text : ''
      const nameHtml = name
        ? `<span class="statblock-${cssKind}-name">${escapeHtml(name)}${usage ? ` (${escapeHtml(usage)})` : ''}.</span> `
        : ''
      return `<div class="statblock-${cssKind}"><p>${nameHtml}<span class="statblock-${cssKind}-description">${escapeHtml(text)}</span></p></div>`
    })
    .join('')
  const sectionTitle = translateEnum('Monster', kind.charAt(0).toUpperCase() + kind.slice(1) + 's', locale)
  return `<div class="statblock-section-title">${escapeHtml(sectionTitle)}</div>${items}`
}

const FEATURE_LIST_KINDS = ['trait', 'action', 'bonusAction', 'reaction', 'legendaryAction'] as const
const FEATURE_LIST_DATA_FIELDS = ['traits', 'actions', 'bonusActions', 'reactions', 'legendaryActions'] as const

/** Project-level fallback for each `show*` toggle, used only when a
 * monster's own YAML leaves the field absent — an explicit `true`/`false`
 * in the monster always wins over this default, same spell/item pattern.
 * All default to `true`. No icon toggle: a monster has no theme-provided
 * icon set, same as an item. */
export interface MonsterDisplayDefaults {
  showImage?: boolean
  showToken?: boolean
  showSources?: boolean
  showTags?: boolean
}

export interface MonsterBlockRenderOptions {
  measurement: MeasurementSystem
  /** Resolved from `mpx.contentLanguage`, same live-refresh getter contract
   * as `measurement` at the `MarkdownRendererOptions` level. Defaults to
   * "en" when not provided (e.g. in tests). */
  language?: ContentLanguage
  /** The project's `translation-overrides.json`, if any — merged on top of
   * the resolved language's catalog before every lookup. */
  overrides?: CatalogOverrides
  preview?: boolean
  displayDefaults?: MonsterDisplayDefaults
  /** The fence's own `{.blue .two-column}` class attribute (markdown-it-attrs
   * already parses this off the ```monster info string and onto the fence
   * token — same syntax an image caption or blockquote variant already
   * uses elsewhere in this renderer), space-separated. Presentation-only:
   * there's no YAML field for this, matching how it isn't part of
   * EncounterPlus's own monster schema either. */
  blockClass?: string
}

const STATBLOCK_COLORS = ['blue', 'green', 'red', 'yellow', 'orange', 'gray', 'purple', 'teal', 'magenta', 'signature']

/** Renders a parsed inline monster (or a standalone monster record, same
 * shape) into the `.statblock` markup the 5.5e theme's CSS already
 * provides (ported from EncounterPlus's own real rendering) — this is the
 * first renderer to actually generate that markup; the CSS existed
 * beforehand but nothing produced matching HTML for it yet. */
export function renderMonsterBlockHtml(
  data: Record<string, unknown>,
  markdown: MarkdownIt,
  options: MonsterBlockRenderOptions,
): string {
  const locale: RenderLocale = { measurement: options.measurement, language: options.language ?? 'en', overrides: options.overrides }
  const name = isNonEmptyString(data.name) ? data.name : 'Unnamed Monster'
  const monsterData = isPlainObject(data.data) ? data.data : {}

  // `.statblock-description` renders as a normal-flow caption right above
  // the card (not inside its border), matching a real stat block's italic
  // intro line — same purpose as a spell/item's descr, just rendered
  // differently. It used to be absolutely positioned over the card's own
  // top margin instead, which overlapped whatever text preceded the block
  // once `descr` ran past a single line.
  const descriptionHtml = isNonEmptyString(data.descr)
    ? `<div class="statblock-description">${markdown.render(data.descr)}</div>`
    : ''

  const blockClasses = (options.blockClass ?? '').split(/\s+/).filter(Boolean)
  const color = blockClasses.find((className) => STATBLOCK_COLORS.includes(className))
  const colorClass = color ? ` ${color}` : ''
  const twoColumn = blockClasses.includes('two-column') ? ' two-column' : ''
  // Not catalog-driven (see the theme CSS): the ability table's floating
  // "SAVE" column header is a static ::before content string, so it needs
  // its own class hook to switch to "JdS" in French.
  const languageClass = locale.language === 'fr' ? ' lang-fr' : ''

  const showTokenDefault = options.displayDefaults?.showToken ?? true
  const showToken = typeof data.showToken === 'boolean' ? data.showToken : showTokenDefault
  const hasToken = isNonEmptyString(data.token) && data.token !== 'monsters/'
  const tokenHtml =
    showToken && hasToken
      ? `<img class="statblock-token" src="${escapeHtml(resourceImagePath(String(data.token), options.preview))}" alt="">`
      : ''

  const subtitle = formatSubtitle(monsterData, locale)

  const ac = isNonEmptyString(monsterData.ac) ? monsterData.ac : undefined
  const initiativeBonus = typeof monsterData.initiativeBonus === 'number' ? monsterData.initiativeBonus : undefined
  const acLine = ac ? `<p class="statblock-topstat-line"><span class="statblock-topstat-name">${escapeHtml(translate('Common.AC', locale.language, locale.overrides))}</span> ${escapeHtml(ac)}</p>` : ''
  const initiativeLine =
    initiativeBonus !== undefined
      ? `<p class="statblock-initiative"><span class="statblock-topstat-name">${escapeHtml(translate('Common.Initiative', locale.language, locale.overrides))}</span> <strong>${escapeHtml(formatSigned(initiativeBonus))}</strong> (${10 + initiativeBonus})</p>`
      : ''
  const primaryHtml = acLine || initiativeLine ? `<div class="statblock-primary">${acLine}${initiativeLine}</div>` : ''

  const hp = isNonEmptyString(monsterData.hp) ? monsterData.hp : undefined
  const hpLine = hp ? `<p class="statblock-topstat-line"><span class="statblock-topstat-name">${escapeHtml(translate('Common.HP', locale.language, locale.overrides))}</span> ${escapeHtml(hp)}</p>` : ''
  const speedText = formatSpeed(monsterData.speed, locale)
  const speedLine = speedText
    ? `<p class="statblock-topstat-line"><span class="statblock-topstat-name">${escapeHtml(translate('Common.Speed', locale.language, locale.overrides))}</span> ${escapeHtml(speedText)}</p>`
    : ''

  const propertyLine = (label: string, value: string | undefined): string =>
    value
      ? `<p class="statblock-property-line"><span class="statblock-property-name">${escapeHtml(label)}${labelSeparator(locale.language)}</span>${escapeHtml(value)}</p>`
      : ''

  const propertiesHtml = [
    propertyLine(translate('Monster.SavingThrows', locale.language, locale.overrides), formatSavingThrows(monsterData, locale)),
    propertyLine(translate('Monster.Skills', locale.language, locale.overrides), formatSkills(monsterData.skills, locale)),
    propertyLine(translate('Monster.Vulnerabilities', locale.language, locale.overrides), formatDamageList(monsterData.damageVulnerabilities, locale)),
    propertyLine(translate('Monster.Resistances', locale.language, locale.overrides), formatDamageList(monsterData.damageResistances, locale)),
    propertyLine(translate('Monster.Immunities', locale.language, locale.overrides), formatDamageList(monsterData.damageImmunities, locale)),
    propertyLine(translate('Monster.ConditionImmunities', locale.language, locale.overrides), formatStringList(monsterData.conditionImmunities)),
    propertyLine(translate('Monster.Senses', locale.language, locale.overrides), formatSenses(monsterData, locale)),
    propertyLine(translate('Monster.Languages', locale.language, locale.overrides), formatLanguageList(monsterData.languages, locale)),
    propertyLine(translate('Monster.Challenge', locale.language, locale.overrides), formatChallenge(monsterData, locale)),
  ].join('')

  const featureListsHtml = FEATURE_LIST_KINDS.map((kind, index) => featureListHtml(kind, monsterData[FEATURE_LIST_DATA_FIELDS[index]], locale)).join(
    '',
  )

  const showImageDefault = options.displayDefaults?.showImage ?? true
  const showImage = typeof data.showImage === 'boolean' ? data.showImage : showImageDefault
  const hasImage = isNonEmptyString(data.image) && data.image !== 'monsters/'
  const imageHtml =
    showImage && hasImage
      ? `<img class="statblock-image" src="${escapeHtml(resourceImagePath(String(data.image), options.preview))}" alt="">`
      : ''

  // Unlike every other property line (rendered inside the card, in the
  // theme's own .statblock-property-line style), Source/Tags render outside
  // the card entirely, in the same shared .compendium-block-details-footer
  // style spell/item use — an explicit request, not something EncounterPlus
  // itself does for a real monster card.
  const detailLine = (label: string, value: string | undefined): string => {
    if (!value) {
      return ''
    }
    return `<p class="compendium-block-detail"><span class="compendium-block-detail-label">${escapeHtml(label)}${labelSeparator(locale.language)}</span><span class="compendium-block-detail-value">${escapeHtml(value)}</span></p>`
  }
  const showSourcesDefault = options.displayDefaults?.showSources ?? true
  const showSources = typeof data.showSources === 'boolean' ? data.showSources : showSourcesDefault
  const showTagsDefault = options.displayDefaults?.showTags ?? true
  const showTags = typeof data.showTags === 'boolean' ? data.showTags : showTagsDefault
  const footerLines = [
    detailLine(translate('Common.Source', locale.language, locale.overrides), showSources ? formatSources(data.sources) : undefined),
    detailLine(translate('Common.Tags', locale.language, locale.overrides), showTags ? formatTags(data.tags) : undefined),
  ]
    .filter(Boolean)
    .join('')
  const footerHtml = footerLines ? `<div class="compendium-block-details compendium-block-details-footer">${footerLines}</div>` : ''

  return [
    descriptionHtml,
    `<div class="statblock${colorClass}${twoColumn}${languageClass}">`,
    tokenHtml,
    `<div class="statblock-title">${escapeHtml(name)}</div>`,
    '<hr class="statblock-tapered-rule">',
    subtitle ? `<div class="statblock-subtitle">${escapeHtml(subtitle)}</div>` : '',
    primaryHtml,
    hpLine,
    speedLine,
    '<hr class="statblock-tapered-rule">',
    abilitiesHtml(monsterData, locale),
    '<hr class="statblock-tapered-rule">',
    propertiesHtml,
    featureListsHtml,
    imageHtml,
    '</div>',
    footerHtml,
  ]
    .filter(Boolean)
    .join('')
}
