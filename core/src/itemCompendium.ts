import {
  COMPENDIUM_ATTRIBUTES_OPTIONAL_FIELDS,
  isPlainObject,
  stripEmptyNestedField,
  stripEmptyValues,
  type ValidationIssue,
} from './compendiumShared.js'

export const ITEM_TYPES = [
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
export const ITEM_RARITIES = ['', 'common', 'uncommon', 'rare', 'veryrare', 'legendary', 'artifact', 'unknown']
export const ITEM_PROPERTIES = [
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
export const ITEM_MASTERIES = ['', 'cleave', 'graze', 'nick', 'push', 'sap', 'slow', 'topple', 'vex']
export const ITEM_DAMAGE_TYPES = [
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
export const ITEM_IMAGE_PATTERN = /^items\/[^/\\]+$/

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

export function validateItemData(relativePath: string, data: unknown, issues: ValidationIssue[]): void {
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

export function stripEmptyItemFields(item: Record<string, unknown>): Record<string, unknown> {
  const cleaned = stripEmptyValues(item, ITEM_TOP_LEVEL_OPTIONAL_FIELDS)
  stripEmptyNestedField(cleaned, 'attributes', COMPENDIUM_ATTRIBUTES_OPTIONAL_FIELDS)
  stripEmptyNestedField(cleaned, 'data', ITEM_DATA_OPTIONAL_FIELDS)
  return cleaned
}
