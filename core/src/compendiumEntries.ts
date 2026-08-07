import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { slugify } from './slug.js'
import type { CreatedContentEntry } from './contentEntries.js'

// Not yet configurable — our schemas/templates are only verified against
// real 5.5e data; a proper 5e format audit is future work.
export const COMPENDIUM_RULESET = '5.5e'

async function writeCompendiumEntry(
  moduleRoot: string,
  kind: string,
  folder: string,
  name: string,
  data: Record<string, unknown>,
): Promise<CreatedContentEntry> {
  const slug = slugify(name)
  const filePath = join(moduleRoot, folder, `${slug}.json`)

  await mkdir(join(moduleRoot, folder), { recursive: true })
  try {
    await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    throw (error as NodeJS.ErrnoException).code === 'EEXIST'
      ? new Error(`A ${kind} with slug "${slug}" already exists.`)
      : error
  }
  return { slug, filePath }
}

export function createItem(moduleRoot: string, name: string, measurement = ''): Promise<CreatedContentEntry> {
  const slug = slugify(name)
  return writeCompendiumEntry(moduleRoot, 'item', 'items', name, {
    id: randomUUID(),
    name,
    slug,
    attributes: {
      measurement,
      ruleset: COMPENDIUM_RULESET,
    },
    data: {
      type: '',
      typeDetail: '',
      rarity: '',
      attunement: false,
      attunementDetail: '',
      value: 0,
      weight: 0,
      ac: 0,
      stealth: false,
      str: 0,
      properties: [] as string[],
      mastery: '',
      dmg1: '',
      dmg2: '',
      dmgType: '',
      range: '',
      container: false,
      capacity: 0,
    },
    descr: '',
    image: 'items/',
    sources: [] as { name: string; page?: number }[],
    tags: [] as string[],
  })
}

export function createSpell(moduleRoot: string, name: string, measurement = ''): Promise<CreatedContentEntry> {
  const slug = slugify(name)
  return writeCompendiumEntry(moduleRoot, 'spell', 'spells', name, {
    id: randomUUID(),
    name,
    slug,
    attributes: {
      measurement,
      ruleset: COMPENDIUM_RULESET,
    },
    data: {
      level: 0,
      school: '',
      ritual: false,
      activation: {
        time: 0,
        unit: '',
        condition: '',
      },
      rangeType: '',
      range: 0,
      areaEffectShape: '',
      areaEffectSize: 0,
      components: [] as string[],
      componentsDetail: '',
      durationType: '',
      duration: 0,
      durationUnit: '',
      classes: [] as string[],
    },
    descr: '',
    image: 'spells/',
    sources: [] as { name: string; page?: number }[],
    tags: [] as string[],
  })
}

export function createMonster(moduleRoot: string, name: string, measurement = ''): Promise<CreatedContentEntry> {
  const slug = slugify(name)
  return writeCompendiumEntry(moduleRoot, 'monster', 'monsters', name, {
    id: randomUUID(),
    name,
    slug,
    token: 'monsters/',
    attributes: {
      measurement,
      ruleset: COMPENDIUM_RULESET,
    },
    data: {
      size: '',
      type: '',
      typeDetail: '',
      alignment: '',
      ac: '',
      hp: '',
      speed: {
        walk: 0,
        burrow: 0,
        climb: 0,
        fly: 0,
        hover: false,
        swim: 0,
        other: '',
      },
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      savingThrows: {} as Record<string, number>,
      skills: {} as Record<string, number>,
      conditionImmunities: [] as string[],
      damageImmunities: [] as string[],
      damageResistances: [] as string[],
      damageVulnerabilities: [] as string[],
      senses: {
        blindsight: 0,
        darkvision: 0,
        tremorsense: 0,
        truesight: 0,
        other: '',
      },
      passivePerception: 0,
      languages: [] as string[],
      cr: '',
      initiativeBonus: 0,
      proficiencyBonus: 0,
      environments: [] as string[],
      traits: [] as { name: string; text: string; usage?: string }[],
      actions: [] as { name: string; text: string; usage?: string }[],
      bonusActions: [] as { name: string; text: string; usage?: string }[],
      reactions: [] as { name: string; text: string; usage?: string }[],
      legendaryActions: [] as { name: string; text: string; usage?: string }[],
    },
    descr: '',
    image: 'monsters/',
    sources: [] as { name: string; page?: number }[],
    tags: [] as string[],
  })
}

export function createBackground(moduleRoot: string, name: string, measurement = ''): Promise<CreatedContentEntry> {
  const slug = slugify(name)
  return writeCompendiumEntry(moduleRoot, 'background', 'backgrounds', name, {
    id: randomUUID(),
    name,
    slug,
    attributes: {
      measurement,
      ruleset: COMPENDIUM_RULESET,
    },
    data: {
      abilities: [] as string[],
      feat: '',
      skills: [] as string[],
      tools: [] as string[],
      equipment: '',
    },
    descr: '',
    sources: [] as { name: string; page?: number }[],
    tags: [] as string[],
    image: 'backgrounds/',
  })
}

export function createRollTable(moduleRoot: string, name: string): Promise<CreatedContentEntry> {
  const slug = slugify(name)
  return writeCompendiumEntry(moduleRoot, 'roll table', 'tables', name, {
    id: randomUUID(),
    name,
    slug,
    columns: [{ name: 'D20' }, { name: 'Result' }],
    rows: [['1', '']],
    descr: '',
    sources: [] as { name: string; page?: number }[],
    tags: [] as string[],
  })
}
