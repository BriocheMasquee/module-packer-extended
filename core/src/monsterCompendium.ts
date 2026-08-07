import {
  COMPENDIUM_ATTRIBUTES_OPTIONAL_FIELDS,
  isPlainObject,
  stripEmptyNestedField,
  stripEmptyValues,
  stripPlaceholderImageField,
  type ValidationIssue,
} from './compendiumShared.js'
import { ITEM_DAMAGE_TYPES } from './itemCompendium.js'

export const MONSTER_SIZES = ['', 'T', 'S', 'M', 'L', 'H', 'G', 'C']
export const MONSTER_TYPES = [
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
export const MONSTER_ALIGNMENTS = ['', 'LG', 'NG', 'CG', 'LN', 'NN', 'CN', 'LE', 'NE', 'CE', 'UU']
export const MONSTER_ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha']
export const MONSTER_SKILLS = [
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
export const MONSTER_DAMAGE_TYPES = ITEM_DAMAGE_TYPES.filter((value) => value !== '')
/** Challenge rating is a closed list, confirmed against EncounterPlus's own
 * `ChallengeRatingToXP` table: 0, the three sub-1 fractions, then 1-30. */
export const MONSTER_CHALLENGE_RATINGS = [
  '',
  '0',
  '1/8',
  '1/4',
  '1/2',
  ...Array.from({ length: 30 }, (_, index) => String(index + 1)),
]
/** `languages`/`environments` are free text (not enum-validated — a
 * homebrew language or setting-specific environment must stay typeable,
 * see docs), but EncounterPlus's own `types.json` (its internal enum-key ->
 * catalog-key map, shared directly by the user) confirms both are backed
 * by a real standard list underneath, with a custom value always allowed
 * alongside it. Listed here as the catalog's own English display word
 * (e.g. "Common", not the internal camelCase code "common") to match how
 * every other free-text-with-suggestions list in this project is authored
 * (compare `conditionImmunities: [Charmed, Exhaustion, Frightened]`) —
 * these are suggestions for authoring, not a validated enum. */
export const MONSTER_LANGUAGES = [
  'Common',
  'Dwarvish',
  'Elvish',
  'Giant',
  'Gnomish',
  'Goblin',
  'Halfling',
  'Orc',
  'Abyssal',
  'Celestial',
  'DeepSpeech',
  'Draconic',
  'Infernal',
  'Primordial',
  'Sylvan',
  'Undercommon',
]
export const MONSTER_ENVIRONMENTS = [
  'Arctic',
  'Coastal',
  'Desert',
  'Forest',
  'Grassland',
  'Hill',
  'Mountain',
  'Swamp',
  'Underdark',
  'Underwater',
  'Urban',
]
export const MONSTER_FEATURE_LIST_FIELDS = ['traits', 'actions', 'bonusActions', 'reactions', 'legendaryActions']
export const MONSTER_IMAGE_PATTERN = /^monsters\/[^/\\]+$/

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
  issues: ValidationIssue[],
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
export function validateMonsterData(relativePath: string, data: unknown, issues: ValidationIssue[]): void {
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
  // A suggestion, not a closed enum — same convention as a spell's school
  // or an item's rarity/mastery/properties (see itemCompendium.ts).
  if (data.alignment !== undefined && typeof data.alignment !== 'string') {
    issues.push({ file: relativePath, message: 'data.alignment must be a string when provided.' })
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

export function stripEmptyMonsterFields(monster: Record<string, unknown>): Record<string, unknown> {
  const cleaned = stripEmptyValues(monster, MONSTER_TOP_LEVEL_OPTIONAL_FIELDS)
  stripPlaceholderImageField(cleaned, 'image', 'monsters/')
  stripPlaceholderImageField(cleaned, 'token', 'monsters/')
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
