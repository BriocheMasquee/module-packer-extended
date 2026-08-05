// Regenerates core/src/catalogEn.ts and core/src/catalogFr.ts from
// EncounterPlus's own localization files
// (github.com/encounterplus/dnd5e/tree/main/lang) — see THIRD-PARTY-LICENSES.md
// for the license basis. Run manually, or by the bi-weekly
// .github/workflows/sync-catalogs.yml (which opens a PR with whatever this
// script changes — it never commits or merges anything itself).
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

const EN_URL = 'https://raw.githubusercontent.com/encounterplus/dnd5e/main/lang/en.json'
const FR_URL = 'https://raw.githubusercontent.com/encounterplus/dnd5e/main/lang/fr.json'

async function fetchJson(url, { allowTrailingComma = false } = {}) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  }
  let text = await response.text()
  if (allowTrailingComma) {
    // Upstream fr.json has historically shipped a trailing comma before its
    // closing brace — not valid JSON, but harmless to strip defensively;
    // a no-op once EncounterPlus fixes it on their end.
    text = text.replace(/,(\s*})/g, '$1')
  }
  return JSON.parse(text)
}

function quoteStr(value) {
  if (value.includes("'") && !value.includes('"')) {
    return JSON.stringify(value)
  }
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function quoteKey(key) {
  return `'${key}'`
}

function renderCatalog(varName, headerLines, keys, entries) {
  const lines = [...headerLines, `export const ${varName}: Record<string, string | { one: string; many: string }> = {`]
  for (const key of keys) {
    const value = entries[key]
    if (value === undefined) {
      continue
    }
    if (typeof value === 'string') {
      lines.push(`  ${quoteKey(key)}: ${quoteStr(value)},`)
    } else {
      lines.push(`  ${quoteKey(key)}: { many: ${quoteStr(value.many)}, one: ${quoteStr(value.one)} },`)
    }
  }
  lines.push('}', '')
  return lines.join('\n')
}

async function main() {
  const en = await fetchJson(EN_URL)
  const fr = await fetchJson(FR_URL, { allowTrailingComma: true })

  // Known upstream key-name mismatch between en.json and fr.json — corrected
  // on ingestion so both catalogs share the same lookup key. A no-op once
  // EncounterPlus renames it on their end.
  if (fr['Item.ContainerCapacityWithUnit'] !== undefined && fr['Item.ContainerCapacity'] === undefined) {
    fr['Item.ContainerCapacity'] = fr['Item.ContainerCapacityWithUnit']
    delete fr['Item.ContainerCapacityWithUnit']
  }

  // Upstream capitalizes these ("Minute", "Jours") as if standalone labels,
  // but every MPX call site only ever uses them inline after a number (e.g.
  // "3 minutes") — French grammar doesn't capitalize a common noun there, so
  // lowercase the first letter on ingestion. A no-op once/if EncounterPlus
  // lowercases these on their end.
  function lowercaseFirst(value) {
    return value.charAt(0).toLowerCase() + value.slice(1)
  }
  for (const key of ['Unit.Day', 'Unit.Hour', 'Unit.Minute', 'Unit.Round']) {
    const entry = fr[key]
    if (entry && typeof entry === 'object') {
      entry.one = lowercaseFirst(entry.one)
      entry.many = lowercaseFirst(entry.many)
    }
  }

  const enKeys = Object.keys(en).sort()
  const frOnlyKeys = Object.keys(fr)
    .filter((key) => !enKeys.includes(key))
    .sort()
  const missingInFr = enKeys.filter((key) => fr[key] === undefined)
  if (missingInFr.length > 0) {
    console.warn(`Warning: ${missingInFr.length} key(s) present in en.json but missing from fr.json:`, missingInFr)
  }
  if (frOnlyKeys.length > 0) {
    console.warn(`Warning: ${frOnlyKeys.length} key(s) present in fr.json but not en.json:`, frOnlyKeys)
  }

  const enSource = renderCatalog(
    'CATALOG_EN',
    [
      "// English label catalog, sourced from EncounterPlus's own localization file",
      '// (lang/en.json in encounterplus/dnd5e) — see THIRD-PARTY-LICENSES.md for the',
      '// license basis (that repo has no LICENSE file of its own; usage was granted',
      '// directly by the EncounterPlus developer). Regenerated periodically from',
      '// upstream by .github/workflows/sync-catalogs.yml (opens a PR, never',
      '// auto-merges) — see catalog.ts for translate()/pluralize() and the',
      '// language/override resolution logic that consumes this data.',
    ],
    enKeys,
    en,
  )
  const frSource = renderCatalog(
    'CATALOG_FR',
    [
      "// French label catalog, sourced from EncounterPlus's own localization file",
      '// (lang/fr.json in encounterplus/dnd5e) — see THIRD-PARTY-LICENSES.md for the',
      '// license basis (that repo has no LICENSE file of its own; usage was granted',
      '// directly by the EncounterPlus developer). Regenerated periodically from',
      '// upstream by .github/workflows/sync-catalogs.yml (opens a PR, never',
      '// auto-merges) — see catalog.ts for translate()/pluralize() and the',
      '// language/override resolution logic that consumes this data.',
      '// One upstream key mismatch corrected on ingestion:',
      '// Item.ContainerCapacityWithUnit -> Item.ContainerCapacity, to match the English',
      '// catalog key. EncounterPlus\'s own untranslated "(à traduire)" placeholders are',
      '// kept as-is, not translated by this script. Unit.Day/Hour/Minute/Round are',
      '// lowercased on ingestion (upstream capitalizes them; every MPX call site uses',
      '// them inline after a number, e.g. "3 minutes", where French doesn\'t capitalize).',
    ],
    enKeys,
    fr,
  )

  await writeFile(join(repoRoot, 'core/src/catalogEn.ts'), enSource, 'utf8')
  await writeFile(join(repoRoot, 'core/src/catalogFr.ts'), frSource, 'utf8')
  console.log(`Wrote ${enKeys.length} keys to catalogEn.ts and catalogFr.ts`)
}

await main()
