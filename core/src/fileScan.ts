import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

export async function listFilesRecursively(root: string, extension?: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(entryPath, extension)))
    } else if (
      entry.isFile() &&
      entry.name !== '.DS_Store' &&
      (!extension || entry.name.endsWith(extension))
    ) {
      files.push(entryPath)
    }
  }
  return files
}
