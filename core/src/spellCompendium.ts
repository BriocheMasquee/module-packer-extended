import {
  COMPENDIUM_ATTRIBUTES_OPTIONAL_FIELDS,
  isPlainObject,
  stripEmptyNestedField,
  stripEmptyValues,
  stripPlaceholderImageField,
  type ValidationIssue,
} from './compendiumShared.js'

export const SPELL_SCHOOLS = [
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
export const SPELL_ACTIVATION_UNITS = ['', 'action', 'bonusAction', 'reaction', 'hour', 'minute']
export const SPELL_RANGE_TYPES = ['', 'self', 'touch', 'sight', 'unlimited']
export const SPELL_AREA_EFFECT_SHAPES = ['', 'cone', 'cube', 'cylinder', 'line', 'square', 'sphere', 'emanation']
export const SPELL_COMPONENTS = ['V', 'S', 'M']
export const SPELL_DURATION_TYPES = ['', 'concentration', 'instantaneous', 'special', 'dispel', 'dispelOrTrigger']
export const SPELL_DURATION_UNITS = ['', 'round', 'minute', 'hour', 'day']
export const SPELL_IMAGE_PATTERN = /^spells\/[^/\\]+$/

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

export function validateSpellData(relativePath: string, data: unknown, issues: ValidationIssue[]): void {
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
  // A suggestion, not a closed enum — the real EncounterPlus form lets you
  // type a custom value alongside the usual options, same convention as an
  // item's rarity/mastery/properties (see itemCompendium.ts).
  if (data.school !== undefined && typeof data.school !== 'string') {
    issues.push({ file: relativePath, message: 'data.school must be a string when provided.' })
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

export function stripEmptySpellFields(spell: Record<string, unknown>): Record<string, unknown> {
  const cleaned = stripEmptyValues(spell, SPELL_TOP_LEVEL_OPTIONAL_FIELDS)
  stripPlaceholderImageField(cleaned, 'image', 'spells/')
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
