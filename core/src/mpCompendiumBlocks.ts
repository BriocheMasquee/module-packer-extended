import { parse as parseYaml } from 'yaml'
import { isPlainObject } from './compendiumShared.js'
import { ITEM_DAMAGE_TYPES, ITEM_PROPERTIES, ITEM_RARITIES, ITEM_TYPES } from './itemCompendium.js'
import {
  MONSTER_ABILITY_KEYS,
  MONSTER_ALIGNMENTS,
  MONSTER_CHALLENGE_RATINGS,
  MONSTER_DAMAGE_TYPES,
  MONSTER_FEATURE_LIST_FIELDS,
  MONSTER_SIZES,
  MONSTER_SKILLS,
  MONSTER_TYPES,
} from './monsterCompendium.js'
import { SPELL_COMPONENTS, SPELL_SCHOOLS } from './spellCompendium.js'

// ---------------------------------------------------------------------------
// Reshapes MP (Module Packer V4)'s own inline ```Item/```Spell/```Monster
// block field vocabulary — free-text, kebab-case, comma-separated — into
// MPX's current flat field vocabulary (structured activation/duration/
// speed/senses/saves, arrays, descr, showImage, ...), the shape
// core/src/{item,spell,monster}Block.ts actually render.
//
// Guiding rule (explicit, 2026-08-06): a value that exists in MP but has no
// direct MPX equivalent is never silently dropped. When there's a dedicated
// free-text fallback field (item type -> typeDetail), it's used; otherwise
// the original value is appended to the block's own descr as a clearly
// labeled "not carried over automatically" note, so a human can decide what
// to do with it instead of losing the information.
// ---------------------------------------------------------------------------

export interface MpCompendiumFieldNotice {
  field: string
  message: string
  originalValue: string
}

export interface MpCompendiumBlockReshape {
  /** The block's own name, for notices — undefined if the block has none
   * (already a separate, reported problem). */
  name?: string
  fieldNotices: MpCompendiumFieldNotice[]
  /** The block's original `image:` (and, for a monster, `token:`) value —
   * MP: a bare filename, resolved relative to the page it's in, same as a
   * page's own image references. The caller copies these into the
   * destination spells//items//monsters/ folder; `yaml` already points at
   * the new "spells/<file>" etc. path. */
  imageReferences: string[]
  kind: 'item' | 'monster' | 'spell'
  yaml: string
}

export interface ReshapeMpCompendiumBlocksResult {
  blocks: MpCompendiumBlockReshape[]
  content: string
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return undefined
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return undefined
}

function bool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    if (/^(true|yes)$/i.test(value.trim())) {
      return true
    }
    if (/^(false|no)$/i.test(value.trim())) {
      return false
    }
  }
  return undefined
}

/** Case/space/hyphen-insensitive match against a known enum — "Very Rare"
 * matches "veryrare", "Melee Weapon" matches "meleeWeapon" (compared with
 * its own separators stripped too). */
function matchEnum(value: string, candidates: readonly string[]): string | undefined {
  const normalized = value.toLowerCase().replace(/[\s_-]/g, '')
  return candidates.find((candidate) => candidate.toLowerCase().replace(/[\s_-]/g, '') === normalized)
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim())
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
  return []
}

/** Matches a free-text list (comma string or array) against a known enum,
 * returning the matched values and the leftovers that didn't match (for the
 * caller to fold into an "unmapped" note instead of dropping them). */
function matchEnumList(value: unknown, candidates: readonly string[]): { matched: string[]; unmatched: string[] } {
  const entries = splitList(value)
  const matched: string[] = []
  const unmatched: string[] = []
  for (const entry of entries) {
    const match = matchEnum(entry, candidates)
    if (match) {
      matched.push(match)
    } else {
      unmatched.push(entry)
    }
  }
  return { matched, unmatched }
}

function yamlArray(values: readonly string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`
}

/** Appends a line to a running "extras" list rather than dropping a value
 * that exists in MP but has no MPX field to hold it — see the guiding rule
 * in this file's header comment. */
function noteExtra(extras: string[], label: string, value: string): void {
  extras.push(`${label}: ${value}`)
}

function withExtras(descr: string | undefined, extras: readonly string[]): string | undefined {
  if (extras.length === 0) {
    return descr
  }
  const note = `_Converted from MP — not carried over automatically:_\n${extras.map((extra) => `- ${extra}`).join('\n')}`
  return descr ? `${descr}\n\n${note}` : note
}

// ---------------------------------------------------------------------------
// Item
// ---------------------------------------------------------------------------

const CURRENCY_TO_GP: Record<string, number> = { cp: 0.01, sp: 0.1, ep: 0.5, gp: 1, pp: 10 }

/** MP wrote value as free text with a currency unit ("1 gp", "50 sp") — MPX
 * only has a single numeric gp field, so a non-gp unit is converted at the
 * standard D&D 5e exchange rate and flagged, rather than silently
 * reinterpreting "50" as 50 gp. */
function parseMpValue(raw: string): { notice?: string; value?: number } {
  const match = raw.match(/^([\d.]+)\s*(cp|sp|ep|gp|pp)?$/i)
  if (!match) {
    return { notice: `Value "${raw}" wasn't recognized — left blank.` }
  }
  const amount = Number(match[1])
  const unit = (match[2] ?? 'gp').toLowerCase()
  const rate = CURRENCY_TO_GP[unit]
  if (unit !== 'gp') {
    return { value: Math.round(amount * rate * 100) / 100 }
  }
  return { value: amount }
}

function reshapeMpItemYaml(raw: Record<string, unknown>): {
  fieldNotices: MpCompendiumFieldNotice[]
  imageReference?: string
  yaml: string
} {
  const fieldNotices: MpCompendiumFieldNotice[] = []
  const extras: string[] = []
  const name = str(raw.name) ?? 'Unnamed Item'
  const slug = str(raw.slug)

  const rawType = str(raw.type)
  const type = rawType ? matchEnum(rawType, ITEM_TYPES) : undefined
  const typeDetail = rawType && !type ? rawType : undefined

  const rawRarity = str(raw.rarity)
  const rarity = rawRarity ? matchEnum(rawRarity, ITEM_RARITIES) : undefined
  if (rawRarity && !rarity) {
    fieldNotices.push({ field: 'rarity', message: `Rarity "${rawRarity}" isn't a recognized MPX rarity — left blank.`, originalValue: rawRarity })
    noteExtra(extras, 'Rarity', rawRarity)
  }

  // MP's "attunement" is the requirement text itself (e.g. "Requires
  // attunement by a monk"), not a boolean — MPX splits that into a boolean
  // plus a separate detail field.
  const rawAttunement = str(raw.attunement)
  const attunement = rawAttunement !== undefined ? true : bool(raw.attunement)

  const rawDamageType = str(raw.damageType)
  const dmgType = rawDamageType ? matchEnum(rawDamageType, ITEM_DAMAGE_TYPES) : undefined
  if (rawDamageType && !dmgType) {
    fieldNotices.push({ field: 'damageType', message: `Damage type "${rawDamageType}" isn't recognized — left blank.`, originalValue: rawDamageType })
    noteExtra(extras, 'Damage type', rawDamageType)
  }

  const { matched: properties, unmatched: unmatchedProperties } = matchEnumList(raw.properties, ITEM_PROPERTIES)
  if (unmatchedProperties.length > 0) {
    fieldNotices.push({
      field: 'properties',
      message: `Propert(y/ies) "${unmatchedProperties.join(', ')}" weren't recognized — dropped from the properties list.`,
      originalValue: unmatchedProperties.join(', '),
    })
    noteExtra(extras, 'Propert(y/ies)', unmatchedProperties.join(', '))
  }

  const rawValue = str(raw.value)
  const parsedValue = rawValue ? parseMpValue(rawValue) : undefined
  if (parsedValue?.notice && rawValue) {
    fieldNotices.push({ field: 'value', message: parsedValue.notice, originalValue: rawValue })
    noteExtra(extras, 'Value', rawValue)
  }

  const source = str(raw.source)
  const descr = withExtras(str(raw.description), extras)
  const image = str(raw.image)
  const showImage = bool(raw['show-image'])

  const lines: string[] = []
  lines.push(`name: ${JSON.stringify(name)}`)
  if (slug) {
    lines.push(`slug: ${JSON.stringify(slug)}`)
  }
  if (image) {
    lines.push(`image: ${JSON.stringify(`items/${image}`)}`)
  }
  if (showImage !== undefined) {
    lines.push(`showImage: ${showImage}`)
  }
  if (type) {
    lines.push(`type: ${JSON.stringify(type)}`)
  } else if (typeDetail) {
    lines.push(`type: "custom"`)
  }
  if (typeDetail) {
    lines.push(`typeDetail: ${JSON.stringify(typeDetail)}`)
  }
  if (rarity) {
    lines.push(`rarity: ${JSON.stringify(rarity)}`)
  }
  if (attunement !== undefined) {
    lines.push(`attunement: ${attunement}`)
  }
  if (rawAttunement) {
    lines.push(`attunementDetail: ${JSON.stringify(rawAttunement)}`)
  }
  if (parsedValue?.value !== undefined) {
    lines.push(`value: ${parsedValue.value}`)
  }
  if (str(raw.primaryDamage)) {
    lines.push(`dmg1: ${JSON.stringify(str(raw.primaryDamage))}`)
  }
  if (str(raw.secondaryDamage)) {
    lines.push(`dmg2: ${JSON.stringify(str(raw.secondaryDamage))}`)
  }
  if (dmgType) {
    lines.push(`dmgType: ${JSON.stringify(dmgType)}`)
  }
  if (properties.length > 0) {
    lines.push(`properties: ${yamlArray(properties)}`)
  }
  if (descr) {
    lines.push(`descr: ${JSON.stringify(descr)}`)
  }
  if (source) {
    lines.push('sources:')
    lines.push(`  - name: ${JSON.stringify(source)}`)
  }

  return { fieldNotices, imageReference: image, yaml: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// Spell
// ---------------------------------------------------------------------------

interface ParsedActivation {
  condition?: string
  notice?: string
  time?: number
  unit?: string
}

/** MP wrote casting time as free text ("1 action", "1 bonus action",
 * "10 minutes", "1 reaction, which you take when..."). Matches the known
 * MPX units; a trailing comma clause on a reaction becomes `condition`.
 * Anything else (e.g. "Special") is left unset and reported. */
function parseMpActivation(raw: string): ParsedActivation {
  const [main, ...rest] = raw.split(',')
  const condition = rest.join(',').trim() || undefined
  const text = main.trim()

  if (/^(\d+)?\s*bonus\s*actions?$/i.test(text)) {
    return { time: 1, unit: 'bonusAction', condition }
  }
  if (/^(\d+)?\s*reactions?$/i.test(text)) {
    return { time: 1, unit: 'reaction', condition }
  }
  const actionMatch = text.match(/^(\d+)\s*actions?$/i)
  if (actionMatch) {
    return { time: Number(actionMatch[1]), unit: 'action', condition }
  }
  const hourMatch = text.match(/^(\d+)\s*hours?$/i)
  if (hourMatch) {
    return { time: Number(hourMatch[1]), unit: 'hour', condition }
  }
  const minuteMatch = text.match(/^(\d+)\s*minutes?$/i)
  if (minuteMatch) {
    return { time: Number(minuteMatch[1]), unit: 'minute', condition }
  }
  return { notice: `Casting time "${raw}" wasn't recognized — left blank.` }
}

interface ParsedDuration {
  duration?: number
  durationType?: string
  durationUnit?: string
  notice?: string
}

const DURATION_UNIT_WORDS: Record<string, string> = {
  round: 'round',
  rounds: 'round',
  minute: 'minute',
  minutes: 'minute',
  hour: 'hour',
  hours: 'hour',
  day: 'day',
  days: 'day',
}

/** MP wrote duration as free text too ("Instantaneous", "Until dispelled",
 * "Concentration, up to 1 minute", "8 hours"). */
function parseMpDuration(raw: string): ParsedDuration {
  const text = raw.trim()
  if (/^instantaneous$/i.test(text)) {
    return { durationType: 'instantaneous' }
  }
  if (/^special$/i.test(text)) {
    return { durationType: 'special' }
  }
  if (/dispelled\s+or\s+triggered/i.test(text)) {
    return { durationType: 'dispelOrTrigger' }
  }
  if (/^until\s+dispelled$/i.test(text) || /^dispelled$/i.test(text)) {
    return { durationType: 'dispel' }
  }

  const concentrationMatch = text.match(
    /^concentration\s*,?\s*(?:up\s*to\s*)?(?:(\d+)\s*(round|rounds|minute|minutes|hour|hours|day|days))?$/i,
  )
  if (concentrationMatch) {
    const [, amount, unit] = concentrationMatch
    return {
      durationType: 'concentration',
      duration: amount ? Number(amount) : undefined,
      durationUnit: unit ? DURATION_UNIT_WORDS[unit.toLowerCase()] : undefined,
    }
  }

  const timedMatch = text.match(/^(\d+)\s*(round|rounds|minute|minutes|hour|hours|day|days)$/i)
  if (timedMatch) {
    return { duration: Number(timedMatch[1]), durationUnit: DURATION_UNIT_WORDS[timedMatch[2].toLowerCase()] }
  }

  return { notice: `Duration "${raw}" wasn't recognized — left blank.` }
}

interface ParsedRange {
  areaEffectShape?: string
  areaEffectSize?: number
  notice?: string
  range?: number
  rangeType?: string
}

const AREA_SHAPE_WORDS: Record<string, string> = {
  cone: 'cone',
  cube: 'cube',
  cylinder: 'cylinder',
  line: 'line',
  radius: 'sphere',
  sphere: 'sphere',
  square: 'square',
  emanation: 'emanation',
}

/** MP wrote range as free text combining a keyword range type with an
 * optional embedded area effect ("Self (30-foot radius)", "Touch"), a plain
 * number of feet ("120"), or "N feet"/"N ft." */
function parseMpRange(raw: string): ParsedRange {
  const text = raw.trim()
  const areaMatch = text.match(/\(\s*(\d+)[\s-]*(?:foot|feet|ft\.?)[\s-]*(cone|cube|cylinder|line|radius|sphere|square|emanation)\s*\)/i)
  const beforeParenthetical = text.replace(/\([^)]*\)/, '').trim()

  let rangeType: string | undefined
  if (/^self$/i.test(beforeParenthetical)) {
    rangeType = 'self'
  } else if (/^touch$/i.test(beforeParenthetical)) {
    rangeType = 'touch'
  } else if (/^sight$/i.test(beforeParenthetical)) {
    rangeType = 'sight'
  } else if (/^unlimited$/i.test(beforeParenthetical)) {
    rangeType = 'unlimited'
  }

  const result: ParsedRange = {}
  if (rangeType) {
    result.rangeType = rangeType
  }
  if (areaMatch) {
    result.areaEffectSize = Number(areaMatch[1])
    result.areaEffectShape = AREA_SHAPE_WORDS[areaMatch[2].toLowerCase()]
  }
  if (rangeType || areaMatch) {
    return result
  }

  const numericMatch = beforeParenthetical.match(/^(\d+)\s*(?:feet|foot|ft\.?)?$/i)
  if (numericMatch) {
    return { range: Number(numericMatch[1]) }
  }

  return { notice: `Range "${raw}" wasn't recognized — left blank.` }
}

function reshapeMpSpellYaml(raw: Record<string, unknown>): {
  fieldNotices: MpCompendiumFieldNotice[]
  imageReference?: string
  yaml: string
} {
  const fieldNotices: MpCompendiumFieldNotice[] = []
  const extras: string[] = []
  const name = str(raw.name) ?? 'Unnamed Spell'
  const slug = str(raw.slug)
  const level = num(raw.level)

  const rawSchool = str(raw.school)
  const school = rawSchool ? matchEnum(rawSchool, SPELL_SCHOOLS) : undefined
  if (rawSchool && !school) {
    fieldNotices.push({ field: 'school', message: `School "${rawSchool}" isn't a recognized 5.5e school — left blank.`, originalValue: rawSchool })
    noteExtra(extras, 'School', rawSchool)
  }

  const ritual = bool(raw.ritual)

  const rawTime = str(raw.time)
  const activation = rawTime ? parseMpActivation(rawTime) : undefined
  if (activation?.notice && rawTime) {
    fieldNotices.push({ field: 'activation', message: activation.notice, originalValue: rawTime })
    noteExtra(extras, 'Casting time', rawTime)
  }

  const rawRange = str(raw.range)
  const range = rawRange ? parseMpRange(rawRange) : undefined
  if (range?.notice && rawRange) {
    fieldNotices.push({ field: 'range', message: range.notice, originalValue: rawRange })
    noteExtra(extras, 'Range', rawRange)
  }

  const rawComponents = str(raw.components)
  const { matched: components, unmatched: unmatchedComponents } = matchEnumList(rawComponents, SPELL_COMPONENTS)
  if (unmatchedComponents.length > 0) {
    fieldNotices.push({
      field: 'components',
      message: `Component(s) "${unmatchedComponents.join(', ')}" weren't recognized (expected V/S/M) — dropped.`,
      originalValue: unmatchedComponents.join(', '),
    })
    noteExtra(extras, 'Component(s)', unmatchedComponents.join(', '))
  }

  const rawDuration = str(raw.duration)
  const duration = rawDuration ? parseMpDuration(rawDuration) : undefined
  if (duration?.notice && rawDuration) {
    fieldNotices.push({ field: 'duration', message: duration.notice, originalValue: rawDuration })
    noteExtra(extras, 'Duration', rawDuration)
  }

  const rawClasses = str(raw.classes)
  const classes = rawClasses ? splitList(rawClasses) : []
  const source = str(raw.source)
  const descr = withExtras(str(raw.description), extras)
  const image = str(raw.image)
  const showImage = bool(raw['show-image'])

  const lines: string[] = []
  lines.push(`name: ${JSON.stringify(name)}`)
  if (slug) {
    lines.push(`slug: ${JSON.stringify(slug)}`)
  }
  if (image) {
    lines.push(`image: ${JSON.stringify(`spells/${image}`)}`)
  }
  if (showImage !== undefined) {
    lines.push(`showImage: ${showImage}`)
  }
  if (level !== undefined) {
    lines.push(`level: ${level}`)
  }
  if (school) {
    lines.push(`school: ${JSON.stringify(school)}`)
  }
  if (ritual !== undefined) {
    lines.push(`ritual: ${ritual}`)
  }
  if (activation && (activation.time !== undefined || activation.unit || activation.condition)) {
    lines.push('activation:')
    if (activation.time !== undefined) {
      lines.push(`  time: ${activation.time}`)
    }
    if (activation.unit) {
      lines.push(`  unit: ${JSON.stringify(activation.unit)}`)
    }
    if (activation.condition) {
      lines.push(`  condition: ${JSON.stringify(activation.condition)}`)
    }
  }
  if (range?.rangeType) {
    lines.push(`rangeType: ${JSON.stringify(range.rangeType)}`)
  }
  if (range?.range !== undefined) {
    lines.push(`range: ${range.range}`)
  }
  if (range?.areaEffectShape) {
    lines.push(`areaEffectShape: ${JSON.stringify(range.areaEffectShape)}`)
  }
  if (range?.areaEffectSize !== undefined) {
    lines.push(`areaEffectSize: ${range.areaEffectSize}`)
  }
  if (components.length > 0) {
    lines.push(`components: ${yamlArray(components)}`)
  }
  if (duration?.durationType) {
    lines.push(`durationType: ${JSON.stringify(duration.durationType)}`)
  }
  if (duration?.duration !== undefined) {
    lines.push(`duration: ${duration.duration}`)
  }
  if (duration?.durationUnit) {
    lines.push(`durationUnit: ${JSON.stringify(duration.durationUnit)}`)
  }
  if (classes.length > 0) {
    lines.push(`classes: ${yamlArray(classes)}`)
  }
  if (descr) {
    lines.push(`descr: ${JSON.stringify(descr)}`)
  }
  if (source) {
    lines.push('sources:')
    lines.push(`  - name: ${JSON.stringify(source)}`)
  }

  return { fieldNotices, imageReference: image, yaml: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// Monster
// ---------------------------------------------------------------------------

const SIZE_WORDS: Record<string, string> = {
  tiny: 'T',
  small: 'S',
  medium: 'M',
  large: 'L',
  huge: 'H',
  gargantuan: 'G',
  colossal: 'C',
}

const ALIGNMENT_WORDS: Record<string, string> = {
  'lawful good': 'LG',
  'neutral good': 'NG',
  'chaotic good': 'CG',
  'lawful neutral': 'LN',
  'true neutral': 'NN',
  neutral: 'NN',
  'chaotic neutral': 'CN',
  'lawful evil': 'LE',
  'neutral evil': 'NE',
  'chaotic evil': 'CE',
  unaligned: 'UU',
  any: 'UU',
}

const SPEED_MODE_WORDS: Record<string, 'burrow' | 'climb' | 'fly' | 'swim'> = {
  burrow: 'burrow',
  burrowing: 'burrow',
  climb: 'climb',
  climbing: 'climb',
  fly: 'fly',
  flying: 'fly',
  swim: 'swim',
  swimming: 'swim',
}

interface ParsedSpeed {
  burrow?: number
  climb?: number
  fly?: number
  hover?: boolean
  other?: string
  swim?: number
  walk?: number
}

/** MP wrote speed as free text: "30 ft.", "30 ft., fly 60 ft. (hover)",
 * "40 ft., swim 30 ft., burrow 20 ft.". The first, unlabeled clause is walk
 * speed; every other clause is labeled with its mode. */
function parseMpSpeed(raw: string): ParsedSpeed {
  const result: ParsedSpeed = {}
  const unrecognized: string[] = []
  const hover = /\(hover\)/i.test(raw)
  const clauses = raw
    .replace(/\(hover\)/i, '')
    .split(',')
    .map((clause) => clause.trim())
    .filter(Boolean)

  for (const clause of clauses) {
    const modeMatch = clause.match(/^(burrow|burrowing|climb|climbing|fly|flying|swim|swimming)\s+(\d+)\s*(?:feet|foot|ft\.?)$/i)
    if (modeMatch) {
      result[SPEED_MODE_WORDS[modeMatch[1].toLowerCase()]] = Number(modeMatch[2])
      continue
    }
    const walkMatch = clause.match(/^(\d+)\s*(?:feet|foot|ft\.?)$/i)
    if (walkMatch && result.walk === undefined) {
      result.walk = Number(walkMatch[1])
      continue
    }
    unrecognized.push(clause)
  }

  if (unrecognized.length > 0) {
    result.other = unrecognized.join(', ')
  }
  if (hover) {
    result.hover = true
  }
  return result
}

interface ParsedSenses {
  blindsight?: number
  darkvision?: number
  other?: string
  passivePerception?: number
  tremorsense?: number
  truesight?: number
}

/** MP wrote senses as free text: "darkvision 60 ft., passive Perception 9",
 * "blindsight 30 ft. (blind beyond this radius), passive Perception 11". */
function parseMpSenses(raw: string): ParsedSenses {
  const result: ParsedSenses = {}
  const unrecognized: string[] = []
  const clauses = raw
    .split(',')
    .map((clause) => clause.trim())
    .filter(Boolean)

  for (const clause of clauses) {
    const perceptionMatch = clause.match(/^passive\s+perception\s+(\d+)/i)
    if (perceptionMatch) {
      result.passivePerception = Number(perceptionMatch[1])
      continue
    }
    const senseMatch = clause.match(/^(blindsight|darkvision|tremorsense|truesight)\s+(\d+)\s*(?:feet|foot|ft\.?)/i)
    if (senseMatch) {
      const key = senseMatch[1].toLowerCase() as 'blindsight' | 'darkvision' | 'tremorsense' | 'truesight'
      result[key] = Number(senseMatch[2])
      continue
    }
    unrecognized.push(clause)
  }

  if (unrecognized.length > 0) {
    result.other = unrecognized.join(', ')
  }
  return result
}

/** MP wrote saving throws/skills as free text: "Str + 2, Con +4",
 * "Stealth +6, Perception +3". Matches ability/skill names case-insensitively;
 * anything unrecognized is reported and preserved as an extra. */
function parseMpModifierList(
  raw: string,
  candidates: readonly string[],
  nameOf: (candidate: string) => string,
): { entries: Array<[string, number]>; unmatched: string[] } {
  const entries: Array<[string, number]> = []
  const unmatched: string[] = []
  for (const clause of splitList(raw)) {
    const match = clause.match(/^(.+?)\s*([+-]\s*\d+)$/)
    if (!match) {
      unmatched.push(clause)
      continue
    }
    const [, rawName, rawModifier] = match
    const candidate = candidates.find((entry) => nameOf(entry).toLowerCase() === rawName.trim().toLowerCase())
    if (!candidate) {
      unmatched.push(clause)
      continue
    }
    entries.push([candidate, Number(rawModifier.replace(/\s+/g, ''))])
  }
  return { entries, unmatched }
}

const ABILITY_NAMES: Record<string, string> = { str: 'Str', dex: 'Dex', con: 'Con', int: 'Int', wis: 'Wis', cha: 'Cha' }
const SKILL_NAMES: Record<string, string> = {
  acrobatics: 'Acrobatics',
  animalHandling: 'Animal Handling',
  arcana: 'Arcana',
  athletics: 'Athletics',
  deception: 'Deception',
  history: 'History',
  insight: 'Insight',
  intimidation: 'Intimidation',
  investigation: 'Investigation',
  medicine: 'Medicine',
  nature: 'Nature',
  perception: 'Perception',
  performance: 'Performance',
  persuasion: 'Persuasion',
  religion: 'Religion',
  sleightOfHand: 'Sleight of Hand',
  stealth: 'Stealth',
  survival: 'Survival',
}

const FEATURE_LIST_MP_KEYS: Record<(typeof MONSTER_FEATURE_LIST_FIELDS)[number], string> = {
  traits: 'traits',
  actions: 'actions',
  bonusActions: 'bonus-actions',
  reactions: 'reactions',
  legendaryActions: 'legendary-actions',
}

function reshapeFeatureList(raw: unknown): { text: string[]; yaml: string[] } {
  const yamlLines: string[] = []
  const textLines: string[] = []
  if (!Array.isArray(raw)) {
    return { text: textLines, yaml: yamlLines }
  }
  for (const entry of raw) {
    if (!isPlainObject(entry)) {
      continue
    }
    const name = str(entry.name)
    const text = str(entry.description)
    yamlLines.push('  -' + (name ? ` name: ${JSON.stringify(name)}` : ''))
    if (text) {
      yamlLines.push(`    text: ${JSON.stringify(text)}`)
    }
    if (name || text) {
      textLines.push(`${name ? `${name}. ` : ''}${text ?? ''}`)
    }
  }
  return { text: textLines, yaml: yamlLines }
}

function reshapeMpMonsterYaml(raw: Record<string, unknown>): {
  fieldNotices: MpCompendiumFieldNotice[]
  imageReferences: string[]
  yaml: string
} {
  const fieldNotices: MpCompendiumFieldNotice[] = []
  const extras: string[] = []
  const name = str(raw.name) ?? 'Unnamed Monster'
  const slug = str(raw.slug)
  const id = str(raw.id)

  const rawSize = str(raw.size)
  const size = rawSize ? (matchEnum(rawSize, MONSTER_SIZES) ?? SIZE_WORDS[rawSize.toLowerCase()]) : undefined
  if (rawSize && !size) {
    fieldNotices.push({ field: 'size', message: `Size "${rawSize}" isn't recognized — left blank.`, originalValue: rawSize })
    noteExtra(extras, 'Size', rawSize)
  }

  const rawType = str(raw.type)
  const type = rawType ? matchEnum(rawType, MONSTER_TYPES) : undefined
  if (rawType && !type) {
    fieldNotices.push({ field: 'type', message: `Type "${rawType}" isn't recognized — left blank.`, originalValue: rawType })
    noteExtra(extras, 'Type', rawType)
  }

  const rawAlignment = str(raw.alignment)
  const alignment = rawAlignment ? (matchEnum(rawAlignment, MONSTER_ALIGNMENTS) ?? ALIGNMENT_WORDS[rawAlignment.toLowerCase()]) : undefined
  if (rawAlignment && !alignment) {
    fieldNotices.push({ field: 'alignment', message: `Alignment "${rawAlignment}" isn't recognized — left blank.`, originalValue: rawAlignment })
    noteExtra(extras, 'Alignment', rawAlignment)
  }

  const ac = str(raw.ac)
  const hp = str(raw.hp)

  const rawSpeed = str(raw.speed)
  const speed = rawSpeed ? parseMpSpeed(rawSpeed) : undefined

  const abilities = Object.fromEntries(
    MONSTER_ABILITY_KEYS.map((key) => [key, num(raw[key])]).filter(([, value]) => value !== undefined),
  ) as Record<string, number>

  const rawSaves = str(raw.saves)
  const savesResult = rawSaves ? parseMpModifierList(rawSaves, MONSTER_ABILITY_KEYS, (key) => ABILITY_NAMES[key]) : undefined
  if (savesResult && savesResult.unmatched.length > 0) {
    fieldNotices.push({
      field: 'saves',
      message: `Saving throw(s) "${savesResult.unmatched.join(', ')}" weren't recognized — dropped.`,
      originalValue: savesResult.unmatched.join(', '),
    })
    noteExtra(extras, 'Saving throw(s)', savesResult.unmatched.join(', '))
  }

  const rawSkills = str(raw.skills)
  const skillsResult = rawSkills ? parseMpModifierList(rawSkills, MONSTER_SKILLS, (key) => SKILL_NAMES[key]) : undefined
  if (skillsResult && skillsResult.unmatched.length > 0) {
    fieldNotices.push({
      field: 'skills',
      message: `Skill(s) "${skillsResult.unmatched.join(', ')}" weren't recognized — dropped.`,
      originalValue: skillsResult.unmatched.join(', '),
    })
    noteExtra(extras, 'Skill(s)', skillsResult.unmatched.join(', '))
  }

  const vulnerabilities = matchEnumList(raw.vulnerabilities, MONSTER_DAMAGE_TYPES)
  const resistances = matchEnumList(raw.resistances, MONSTER_DAMAGE_TYPES)
  const damageImmunities = matchEnumList(raw.damageImmunities, MONSTER_DAMAGE_TYPES)
  for (const [field, result] of [
    ['vulnerabilities', vulnerabilities],
    ['resistances', resistances],
    ['damageImmunities', damageImmunities],
  ] as const) {
    if (result.unmatched.length > 0) {
      fieldNotices.push({
        field,
        message: `${field}: "${result.unmatched.join(', ')}" weren't recognized damage types — dropped.`,
        originalValue: result.unmatched.join(', '),
      })
      noteExtra(extras, field, result.unmatched.join(', '))
    }
  }
  const conditionImmunities = splitList(raw.conditionImmunities)

  const rawSenses = str(raw.senses)
  const senses = rawSenses ? parseMpSenses(rawSenses) : undefined

  const languages = splitList(raw.languages)

  const rawChallenge = str(raw.challenge)
  const cr = rawChallenge ? (MONSTER_CHALLENGE_RATINGS.includes(rawChallenge) ? rawChallenge : undefined) : undefined
  if (rawChallenge && !cr) {
    fieldNotices.push({ field: 'challenge', message: `Challenge rating "${rawChallenge}" isn't recognized — left blank.`, originalValue: rawChallenge })
    noteExtra(extras, 'Challenge rating', rawChallenge)
  }

  const environments = matchEnumList(raw.environments, [])
  const rawEnvironments = splitList(raw.environments)

  const image = str(raw.image)
  const token = str(raw.token)

  // Mythic actions have no MPX equivalent at all (an old 5.5e-era concept
  // MPX's schema never adopted) — folded into descr rather than dropped.
  const mythicActions = reshapeFeatureList(raw['mythic-actions'])
  if (mythicActions.text.length > 0) {
    noteExtra(extras, 'Mythic Actions (not a supported MPX section)', mythicActions.text.join(' / '))
  }

  const descr = withExtras(str(raw.description), extras)

  const lines: string[] = []
  lines.push(`name: ${JSON.stringify(name)}`)
  if (id) {
    lines.push(`id: ${JSON.stringify(id)}`)
  }
  if (slug) {
    lines.push(`slug: ${JSON.stringify(slug)}`)
  }
  if (image) {
    lines.push(`image: ${JSON.stringify(`monsters/${image}`)}`)
  }
  if (token) {
    lines.push(`token: ${JSON.stringify(`monsters/${token}`)}`)
  }
  if (size) {
    lines.push(`size: ${JSON.stringify(size)}`)
  }
  if (type) {
    lines.push(`type: ${JSON.stringify(type)}`)
  }
  if (alignment) {
    lines.push(`alignment: ${JSON.stringify(alignment)}`)
  }
  if (ac) {
    lines.push(`ac: ${JSON.stringify(ac)}`)
  }
  if (hp) {
    lines.push(`hp: ${JSON.stringify(hp)}`)
  }
  if (speed && Object.keys(speed).length > 0) {
    lines.push('speed:')
    for (const [key, value] of Object.entries(speed)) {
      lines.push(`  ${key}: ${typeof value === 'string' ? JSON.stringify(value) : value}`)
    }
  }
  if (Object.keys(abilities).length > 0) {
    lines.push(`abilities: { ${Object.entries(abilities).map(([key, value]) => `${key}: ${value}`).join(', ')} }`)
  }
  if (savesResult && savesResult.entries.length > 0) {
    lines.push(`savingThrows: { ${savesResult.entries.map(([key, value]) => `${key}: ${value}`).join(', ')} }`)
  }
  if (skillsResult && skillsResult.entries.length > 0) {
    lines.push(`skills: { ${skillsResult.entries.map(([key, value]) => `${key}: ${value}`).join(', ')} }`)
  }
  if (vulnerabilities.matched.length > 0) {
    lines.push(`damageVulnerabilities: ${yamlArray(vulnerabilities.matched)}`)
  }
  if (resistances.matched.length > 0) {
    lines.push(`damageResistances: ${yamlArray(resistances.matched)}`)
  }
  if (damageImmunities.matched.length > 0) {
    lines.push(`damageImmunities: ${yamlArray(damageImmunities.matched)}`)
  }
  if (conditionImmunities.length > 0) {
    lines.push(`conditionImmunities: ${yamlArray(conditionImmunities)}`)
  }
  if (senses && Object.keys(senses).length > 0) {
    const { passivePerception, ...sensesFields } = senses
    if (Object.keys(sensesFields).length > 0) {
      lines.push('senses:')
      for (const [key, value] of Object.entries(sensesFields)) {
        lines.push(`  ${key}: ${typeof value === 'string' ? JSON.stringify(value) : value}`)
      }
    }
    if (passivePerception !== undefined) {
      lines.push(`passivePerception: ${passivePerception}`)
    }
  }
  if (languages.length > 0) {
    lines.push(`languages: ${yamlArray(languages)}`)
  }
  if (cr) {
    lines.push(`cr: ${JSON.stringify(cr)}`)
  }
  if (rawEnvironments.length > 0) {
    lines.push(`environments: ${yamlArray(environments.matched.length > 0 ? environments.matched : rawEnvironments)}`)
  }
  for (const field of MONSTER_FEATURE_LIST_FIELDS) {
    const reshaped = reshapeFeatureList(raw[FEATURE_LIST_MP_KEYS[field]])
    if (reshaped.yaml.length > 0) {
      lines.push(`${field}:`)
      lines.push(...reshaped.yaml)
    }
  }
  if (descr) {
    lines.push(`descr: ${JSON.stringify(descr)}`)
  }

  return { fieldNotices, imageReferences: [image, token].filter((value): value is string => Boolean(value)), yaml: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// Block scanning
// ---------------------------------------------------------------------------

/** Finds every fenced ```Item/```Spell/```Monster block (MP's own,
 * case-insensitive fence info string, with an optional trailing `{.class}`
 * list preserved as-is — e.g. MP's own `{.two-column}` on a monster block is
 * already a real MPX theme class) and replaces its YAML body with the
 * MPX-shaped equivalent. */
export function reshapeMpCompendiumBlocks(content: string): ReshapeMpCompendiumBlocksResult {
  const blocks: MpCompendiumBlockReshape[] = []
  const lines = content.split(/\r?\n/)
  const output: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const fenceMatch = line.match(/^(\s*)(```+|~~~+)\s*(item|spell|monster)\s*(\{[^}]*\})?\s*$/i)
    if (!fenceMatch) {
      output.push(line)
      index += 1
      continue
    }

    const [, indent, fence, kindMatch, classAttribute] = fenceMatch
    const kind = kindMatch.toLowerCase() as 'item' | 'monster' | 'spell'
    const closeIndex = lines.findIndex(
      (candidate, candidateIndex) => candidateIndex > index && new RegExp(`^\\s*${fence}\\s*$`).test(candidate),
    )
    if (closeIndex === -1) {
      // No closing fence — leave the rest untouched, matching how the
      // renderer's own error handling treats an unclosed block.
      output.push(...lines.slice(index))
      break
    }

    const yamlSource = lines.slice(index + 1, closeIndex).join('\n')
    let parsed: unknown
    try {
      parsed = parseYaml(yamlSource)
    } catch {
      // Invalid YAML: leave the block exactly as-is rather than lose data.
      output.push(...lines.slice(index, closeIndex + 1))
      index = closeIndex + 1
      continue
    }
    if (!isPlainObject(parsed)) {
      output.push(...lines.slice(index, closeIndex + 1))
      index = closeIndex + 1
      continue
    }

    const reshaped =
      kind === 'spell'
        ? { ...reshapeMpSpellYaml(parsed), imageReferences: undefined as string[] | undefined }
        : kind === 'item'
          ? { ...reshapeMpItemYaml(parsed), imageReferences: undefined as string[] | undefined }
          : reshapeMpMonsterYaml(parsed)
    const imageReferences =
      'imageReferences' in reshaped && reshaped.imageReferences
        ? reshaped.imageReferences
        : 'imageReference' in reshaped && reshaped.imageReference
          ? [reshaped.imageReference]
          : []

    blocks.push({
      fieldNotices: reshaped.fieldNotices,
      imageReferences,
      kind,
      name: str(parsed.name),
      yaml: reshaped.yaml,
    })

    output.push(`${indent}${fence}${kind}${classAttribute ? ` ${classAttribute}` : ''}`)
    output.push(...reshaped.yaml.split('\n').map((yamlLine) => `${indent}${yamlLine}`))
    output.push(`${indent}${fence}`)
    index = closeIndex + 1
  }

  return { blocks, content: output.join('\n') }
}
