import { join } from 'node:path'
import { listFilesRecursively } from './fileScan.js'
import { readCompendiumImportArchive } from './mapEncounterExport.js'

export const RULE_MANIFEST_FILE_NAME = 'rules.json'
export const RULE_IMAGE_PATTERN = /^rules\/[^/\\]+$/

export interface RuleImportZip {
  zipFilePath: string
  records: Record<string, unknown>[]
  resources: Map<string, Buffer>
}

export interface RuleImportZipFailure {
  zipFilePath: string
  error: string
}

/** Reads every `.zip` in the project's `rules/` folder — each one a raw
 * EncounterPlus "Rule" Compendium export (a `rules.json` manifest holding
 * *every* exported entry, plus any referenced images) — with no MPX-side
 * schema. Shared by the build (buildModule.ts merges these into the
 * module's own rules.json) and the Compendium Explorer panel (which only
 * needs entry names, not a full build). */
export async function readRuleImportZips(
  moduleRoot: string,
): Promise<{ succeeded: RuleImportZip[]; failed: RuleImportZipFailure[] }> {
  const zipPaths = await listFilesRecursively(join(moduleRoot, 'rules'), '.zip')
  const succeeded: RuleImportZip[] = []
  const failed: RuleImportZipFailure[] = []

  await Promise.all(
    zipPaths.map(async (zipFilePath) => {
      try {
        const { records, resources } = await readCompendiumImportArchive(zipFilePath, RULE_MANIFEST_FILE_NAME)
        succeeded.push({ zipFilePath, records, resources })
      } catch (error) {
        failed.push({ zipFilePath, error: (error as Error).message })
      }
    }),
  )

  return { succeeded, failed }
}
