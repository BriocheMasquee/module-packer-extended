import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CatalogOverrides } from './catalog.js'
import type { ContentLanguage } from './localization.js'
import { isNonEmptyString, isPlainObject, type ValidationIssue } from './compendiumShared.js'

/** A project-root JSON file letting the user override a specific catalog
 * key's displayed word — for either language, without forking the
 * extension's own bundled catalog. Never bundled into the built .module
 * (see fileScan.ts's universal exclusion list). */
export const TRANSLATION_OVERRIDES_FILENAME = 'translation-overrides.json'

const OVERRIDES_FILE_LABEL = TRANSLATION_OVERRIDES_FILENAME

function isValidEntry(value: unknown): value is string | { one: string; many: string } {
  if (typeof value === 'string') {
    return true
  }
  return isPlainObject(value) && isNonEmptyString(value.one) && isNonEmptyString(value.many)
}

/** Lenient by design: an unrecognized language key, or a malformed entry
 * under a recognized one, is skipped with an issue rather than discarding
 * the whole file — a single typo shouldn't cost the user every other
 * override they've already set up. */
export function parseCatalogOverrides(raw: unknown): { overrides: CatalogOverrides; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = []
  if (!isPlainObject(raw)) {
    return { overrides: {}, issues: [{ file: OVERRIDES_FILE_LABEL, message: 'Must be a JSON object mapping "en"/"fr" to catalog key overrides.' }] }
  }

  const overrides: CatalogOverrides = {}
  for (const [language, entries] of Object.entries(raw)) {
    // Not a language — the editor-tooling convention (JSON Schema
    // autocomplete/hover) pointer the create command writes into the file.
    if (language === '$schema') {
      continue
    }
    if (language !== 'en' && language !== 'fr') {
      issues.push({ file: OVERRIDES_FILE_LABEL, message: `Unrecognized language "${language}" (expected "en" or "fr") — ignored.` })
      continue
    }
    if (!isPlainObject(entries)) {
      issues.push({ file: OVERRIDES_FILE_LABEL, message: `"${language}" must map catalog keys to override text — ignored.` })
      continue
    }
    const languageOverrides: Record<string, string | { one: string; many: string }> = {}
    for (const [key, value] of Object.entries(entries)) {
      if (!isValidEntry(value)) {
        issues.push({
          file: OVERRIDES_FILE_LABEL,
          message: `"${language}.${key}" must be a string, or a { one, many } object — ignored.`,
        })
        continue
      }
      languageOverrides[key] = value
    }
    overrides[language as ContentLanguage] = languageOverrides
  }
  return { overrides, issues }
}

/** Absent file is not an error — most projects have no overrides at all. */
export async function loadCatalogOverrides(projectRoot: string): Promise<{ overrides: CatalogOverrides; issues: ValidationIssue[] }> {
  let raw: string
  try {
    raw = await readFile(join(projectRoot, TRANSLATION_OVERRIDES_FILENAME), 'utf8')
  } catch {
    return { overrides: {}, issues: [] }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { overrides: {}, issues: [{ file: OVERRIDES_FILE_LABEL, message: `Invalid JSON: ${(error as Error).message}` }] }
  }
  return parseCatalogOverrides(parsed)
}
