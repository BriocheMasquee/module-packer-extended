import { randomUUID } from 'node:crypto'
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface ModuleJson {
  id: string
  name: string
  slug: string
  version: string
  system: string
  author: string
  description: string
  tags: string[]
  image: string
}

export type WorkspaceKind = 'empty' | 'mpxProject' | 'unsupported'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

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
    author: '',
    description: '',
    tags: [],
    image: '',
  }

  await writeFile(join(targetFolder, 'module.json'), `${JSON.stringify(moduleJson, null, 2)}\n`, 'utf8')
  await mkdir(join(targetFolder, 'images'))

  const assetsFolder = join(targetFolder, 'assets')
  await mkdir(assetsFolder)
  await cp(themeSourceFolder, assetsFolder, { recursive: true })
}
