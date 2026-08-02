import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { slugify } from './slug.js'
import type { CreatedContentEntry } from './contentEntries.js'

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

export function createItem(moduleRoot: string, name: string): Promise<CreatedContentEntry> {
  const slug = slugify(name)
  return writeCompendiumEntry(moduleRoot, 'item', 'items', name, {
    id: randomUUID(),
    name,
    slug,
    attributes: {
      measurement: '',
      ruleset: '',
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

export function createSpell(moduleRoot: string, name: string): Promise<CreatedContentEntry> {
  const slug = slugify(name)
  return writeCompendiumEntry(moduleRoot, 'spell', 'spells', name, {
    id: randomUUID(),
    name,
    slug,
    attributes: {
      measurement: '',
      ruleset: '',
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
