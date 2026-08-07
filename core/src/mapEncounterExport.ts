import { Open } from 'unzipper'

export interface ExportedArchive {
  record: Record<string, unknown>
  resources: Map<string, Buffer>
}

export interface CompendiumImportArchive {
  records: Record<string, unknown>[]
  resources: Map<string, Buffer>
}

function isHiddenOrMacosxPath(entryPath: string): boolean {
  if (entryPath.startsWith('__MACOSX/')) {
    return true
  }
  return entryPath.split('/').some((segment) => segment.startsWith('.'))
}

async function readArchiveManifest(
  archivePath: string,
  manifestFileName: string,
): Promise<{ records: unknown[]; resources: Map<string, Buffer> }> {
  let directory: Awaited<ReturnType<typeof Open.file>>
  try {
    directory = await Open.file(archivePath)
  } catch (error) {
    throw new Error(`is not a readable export archive: ${(error as Error).message}`, { cause: error })
  }

  const manifestEntry = directory.files.find(
    (file) => file.type === 'File' && file.path === manifestFileName,
  )
  if (!manifestEntry) {
    throw new Error(`does not contain ${manifestFileName}.`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse((await manifestEntry.buffer()).toString('utf8'))
  } catch (error) {
    throw new Error(`contains an invalid ${manifestFileName}: ${(error as Error).message}`, { cause: error })
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`must contain an array in ${manifestFileName}.`)
  }

  const resources = new Map<string, Buffer>()
  for (const file of directory.files) {
    if (file.type !== 'File' || file.path === manifestFileName || isHiddenOrMacosxPath(file.path)) {
      continue
    }
    resources.set(file.path, await file.buffer())
  }

  return { records: parsed, resources }
}

/**
 * Reads an EncounterPlus map/encounter export archive: a zip containing a
 * single-object manifest (maps.json or encounters.json) plus any number of
 * resource files (images, etc.) referenced by that manifest.
 */
export async function readExportArchive(
  archivePath: string,
  manifestFileName: string,
): Promise<ExportedArchive> {
  const { records, resources } = await readArchiveManifest(archivePath, manifestFileName)
  if (records.length !== 1) {
    throw new Error(`must contain exactly one object in ${manifestFileName}.`)
  }
  const [record] = records
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    throw new Error(`contains an invalid object in ${manifestFileName}.`)
  }
  return { record: record as Record<string, unknown>, resources }
}

/**
 * Detects which manifest an EncounterPlus export zip carries, without
 * knowing its content type ahead of time — used by the generic "Import
 * Compendium" command to route a dropped `.zip` to the right project
 * folder. Every real export (map/encounter/item/spell/monster/background/
 * table/rule) puts exactly one `.json` manifest at the archive root,
 * alongside the resources it references; this returns that file's name
 * (e.g. `"rules.json"`) or undefined if the zip doesn't look like one.
 */
export async function detectManifestFileName(archivePath: string): Promise<string | undefined> {
  let directory: Awaited<ReturnType<typeof Open.file>>
  try {
    directory = await Open.file(archivePath)
  } catch {
    return undefined
  }
  const rootJsonFiles = directory.files.filter(
    (file) => file.type === 'File' && file.path.endsWith('.json') && !file.path.includes('/'),
  )
  return rootJsonFiles.length === 1 ? rootJsonFiles[0].path : undefined
}

/**
 * Reads an EncounterPlus Compendium export archive: a zip containing a
 * manifest (e.g. rules.json) holding an array of *every* exported entry
 * (unlike a map/encounter export, which always holds exactly one), plus
 * any resource files (images) those entries reference. Used for content
 * types MPX doesn't author itself (no YAML/schema) — entries are passed
 * through close to verbatim at build time, see readRuleImports.
 */
export async function readCompendiumImportArchive(
  archivePath: string,
  manifestFileName: string,
): Promise<CompendiumImportArchive> {
  const { records, resources } = await readArchiveManifest(archivePath, manifestFileName)
  for (const record of records) {
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      throw new Error(`contains an invalid object in ${manifestFileName}.`)
    }
  }
  return { records: records as Record<string, unknown>[], resources }
}
