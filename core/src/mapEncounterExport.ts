import { Open } from 'unzipper'

export interface ExportedArchive {
  record: Record<string, unknown>
  resources: Map<string, Buffer>
}

function isHiddenOrMacosxPath(entryPath: string): boolean {
  if (entryPath.startsWith('__MACOSX/')) {
    return true
  }
  return entryPath.split('/').some((segment) => segment.startsWith('.'))
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
  let directory: Awaited<ReturnType<typeof Open.file>>
  try {
    directory = await Open.file(archivePath)
  } catch (error) {
    throw new Error(`is not a readable export archive: ${(error as Error).message}`)
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
    throw new Error(`contains an invalid ${manifestFileName}: ${(error as Error).message}`)
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error(`must contain exactly one object in ${manifestFileName}.`)
  }
  const [record] = parsed
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    throw new Error(`contains an invalid object in ${manifestFileName}.`)
  }

  const resources = new Map<string, Buffer>()
  for (const file of directory.files) {
    if (file.type !== 'File' || file.path === manifestFileName || isHiddenOrMacosxPath(file.path)) {
      continue
    }
    resources.set(file.path, await file.buffer())
  }

  return { record: record as Record<string, unknown>, resources }
}
