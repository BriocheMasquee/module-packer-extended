import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { TRANSLATION_OVERRIDES_FILENAME } from './catalogOverrides.js'

// A project-root authoring aid, never part of the built .module — excluded
// here (not just by living outside images/assets/pages/etc., which already
// keeps it out of every build scan) so it stays excluded even if it's ever
// dropped inside a folder this function copies wholesale (images/, assets/).
const EXCLUDED_FILE_NAMES = new Set(['.DS_Store', TRANSLATION_OVERRIDES_FILENAME])

export async function listFilesRecursively(root: string, extension?: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(entryPath, extension)))
    } else if (
      entry.isFile() &&
      !EXCLUDED_FILE_NAMES.has(entry.name) &&
      (!extension || entry.name.endsWith(extension))
    ) {
      files.push(entryPath)
    }
  }
  return files
}
