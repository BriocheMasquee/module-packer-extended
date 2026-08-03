// Regenerates extension/resources/schemas/translation-overrides.schema.json
// from core's own catalog data (core/dist/catalogEn.js) — one property per
// known catalog key, so editing translation-overrides.json gets autocomplete
// and a hover showing the key's current official English value. Run after
// core/src/catalogEn.ts changes (manually, or by the bi-weekly
// .github/workflows/sync-catalogs.yml run that also regenerates catalogEn.ts/
// catalogFr.ts from upstream).
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

const { CATALOG_EN } = await import(join(repoRoot, 'core/dist/catalogEn.js'))

const ENTRY_VALUE_SCHEMA = {
  oneOf: [
    { type: 'string' },
    {
      type: 'object',
      properties: {
        one: { type: 'string' },
        many: { type: 'string' },
      },
      required: ['one', 'many'],
      additionalProperties: false,
    },
  ],
}

function keyProperty(key, value) {
  const currentValue = typeof value === 'string' ? value : `${value.one} / ${value.many}`
  return {
    ...ENTRY_VALUE_SCHEMA,
    markdownDescription: `Overrides catalog key \`${key}\`. Current official value: **${currentValue}**.`,
  }
}

function languageProperties() {
  const properties = {}
  for (const [key, value] of Object.entries(CATALOG_EN)) {
    properties[key] = keyProperty(key, value)
  }
  return properties
}

const properties = languageProperties()

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'MPX Translation Overrides',
  description:
    'Renames specific catalog labels used by MPX-generated Compendium blocks, per language — project-wide, everywhere that key is looked up. Keys not listed here are still accepted (e.g. a key added upstream since this schema was generated).',
  type: 'object',
  properties: {
    $schema: { type: 'string' },
    en: {
      type: 'object',
      description: 'Overrides applied when mpx.contentLanguage is "en".',
      properties,
    },
    fr: {
      type: 'object',
      description: 'Overrides applied when mpx.contentLanguage is "fr".',
      properties,
    },
  },
  additionalProperties: false,
}

const outputPath = join(repoRoot, 'extension/resources/schemas/translation-overrides.schema.json')
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, 'utf8')
console.log(`Wrote ${Object.keys(properties).length} catalog key properties to ${outputPath}`)
