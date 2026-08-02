import { randomUUID } from 'node:crypto'
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { slugify } from './slug.js'

export const MODULE_CATEGORIES = ['', 'adventure', 'pack', 'rules', 'compendium', 'other'] as const
export type ModuleCategory = (typeof MODULE_CATEGORIES)[number]

export interface ModuleJson {
  id: string
  name: string
  slug: string
  version: string
  system: string
  acronym: string
  category: ModuleCategory
  author: string
  shortDescr: string
  descr: string
  tags: string[]
  image: string
  banner: string
  website: string
  repository: string
  package: string
}

export type WorkspaceKind = 'empty' | 'mpxProject' | 'unsupported'

export async function detectWorkspaceKind(folder: string): Promise<WorkspaceKind> {
  const entries = await readdir(folder).catch(() => [] as string[])
  if (entries.length === 0) {
    return 'empty'
  }
  if (entries.includes('module.json')) {
    return 'mpxProject'
  }
  return 'unsupported'
}

export async function createModuleProject(
  targetFolder: string,
  themeSourceFolder: string,
): Promise<void> {
  const entries = await readdir(targetFolder).catch(() => [] as string[])
  if (entries.length > 0) {
    throw new Error('The new MPX project folder must be empty.')
  }

  const folderName = targetFolder.split(/[\\/]/).filter(Boolean).pop() ?? 'module'
  const moduleJson: ModuleJson = {
    id: randomUUID(),
    name: folderName,
    slug: slugify(folderName),
    version: '1.0.0',
    system: 'dnd5e',
    acronym: '',
    category: '',
    author: '',
    shortDescr: '',
    descr: '',
    tags: [],
    image: '',
    banner: '',
    website: '',
    repository: '',
    package: '',
  }

  await writeFile(join(targetFolder, 'module.json'), `${JSON.stringify(moduleJson, null, 2)}\n`, 'utf8')
  await mkdir(join(targetFolder, 'images'))

  const assetsFolder = join(targetFolder, 'assets')
  await mkdir(assetsFolder)
  await cp(themeSourceFolder, assetsFolder, { recursive: true })

  const settingsJson = {
    'mpx.autoIncrementVersion': true,
    'mpx.contentLanguage': 'en',
    'mpx.defaultMeasurement': 'auto',
  }
  await mkdir(join(targetFolder, '.vscode'), { recursive: true })
  await writeFile(
    join(targetFolder, '.vscode', 'settings.json'),
    `${JSON.stringify(settingsJson, null, 2)}\n`,
    'utf8',
  )
}
