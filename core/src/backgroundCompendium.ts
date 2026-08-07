import {
  COMPENDIUM_ATTRIBUTES_OPTIONAL_FIELDS,
  isPlainObject,
  stripEmptyNestedField,
  stripEmptyValues,
  stripPlaceholderImageField,
  type ValidationIssue,
} from './compendiumShared.js'

/** Suggestions only, not a validated enum — a real EncounterPlus background
 * form lets a custom ability/skill/language/tool alongside the standard
 * list, same convention as a monster's `languages`/`environments` (see
 * monsterCompendium.ts). */
export const BACKGROUND_ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha']
export const BACKGROUND_SKILLS = [
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
export const BACKGROUND_LANGUAGES = [
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
export const BACKGROUND_IMAGE_PATTERN = /^backgrounds\/[^/\\]+$/

const BACKGROUND_TOP_LEVEL_OPTIONAL_FIELDS = ['descr', 'sources', 'tags']
const BACKGROUND_DATA_OPTIONAL_FIELDS = ['abilities', 'feat', 'skills', 'tools', 'languages', 'equipment']
const BACKGROUND_DATA_STRING_ARRAY_FIELDS = ['abilities', 'skills', 'tools', 'languages']

export function validateBackgroundData(relativePath: string, data: unknown, issues: ValidationIssue[]): void {
  if (data === undefined) {
    return
  }
  if (!isPlainObject(data)) {
    issues.push({ file: relativePath, message: 'data must be an object when provided.' })
    return
  }
  for (const field of BACKGROUND_DATA_STRING_ARRAY_FIELDS) {
    if (data[field] !== undefined && (!Array.isArray(data[field]) || !data[field].every((value) => typeof value === 'string'))) {
      issues.push({ file: relativePath, message: `data.${field} must be an array of strings when provided.` })
    }
  }
  if (data.feat !== undefined && typeof data.feat !== 'string') {
    issues.push({ file: relativePath, message: 'data.feat must be a string when provided.' })
  }
  if (data.equipment !== undefined && typeof data.equipment !== 'string') {
    issues.push({ file: relativePath, message: 'data.equipment must be a string when provided.' })
  }
}

export function stripEmptyBackgroundFields(background: Record<string, unknown>): Record<string, unknown> {
  const cleaned = stripEmptyValues(background, BACKGROUND_TOP_LEVEL_OPTIONAL_FIELDS)
  stripPlaceholderImageField(cleaned, 'image', 'backgrounds/')
  stripEmptyNestedField(cleaned, 'attributes', COMPENDIUM_ATTRIBUTES_OPTIONAL_FIELDS)
  stripEmptyNestedField(cleaned, 'data', BACKGROUND_DATA_OPTIONAL_FIELDS)
  return cleaned
}
