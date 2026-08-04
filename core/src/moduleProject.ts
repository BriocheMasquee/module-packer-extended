import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { slugify } from './slug.js'
import type { ProjectTheme } from './themeCatalog.js'
import { listFilesRecursively } from './fileScan.js'

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
  theme: ProjectTheme,
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
  // theme.json is metadata for the extension's own theme catalog, not
  // something that belongs inside a project's assets/ folder.
  for (const filePath of await listFilesRecursively(theme.themeDirectory)) {
    const relativePath = relative(theme.themeDirectory, filePath)
    if (relativePath === 'theme.json') {
      continue
    }
    const targetPath = join(assetsFolder, relativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await copyFile(filePath, targetPath)
  }

  const settingsJson = {
    'mpx.projectTheme': theme.id,
    'mpx.autoIncrementVersion': true,
    'mpx.contentLanguage': 'en',
    'mpx.defaultMeasurement': 'auto',
    'mpx.defaultShowSpellImage': true,
    'mpx.defaultShowSpellSchoolIcon': true,
    'mpx.defaultShowSpellAreaEffectIcon': true,
    'mpx.defaultShowSpellSources': true,
    'mpx.defaultShowSpellTags': true,
    'mpx.defaultShowItemImage': true,
    'mpx.defaultShowItemSources': true,
    'mpx.defaultShowItemTags': true,
    'mpx.defaultShowMonsterImage': true,
    'mpx.defaultShowMonsterToken': true,
    'mpx.defaultShowMonsterSources': true,
    'mpx.defaultShowMonsterTags': true,
    'mpx.autoDetectRollTables': true,
  }
  await mkdir(join(targetFolder, '.vscode'), { recursive: true })
  await writeFile(
    join(targetFolder, '.vscode', 'settings.json'),
    `${JSON.stringify(settingsJson, null, 2)}\n`,
    'utf8',
  )
}
