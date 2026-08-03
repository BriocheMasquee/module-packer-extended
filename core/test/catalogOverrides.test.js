const assert = require('node:assert/strict')
const { mkdtemp, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const { parseCatalogOverrides, loadCatalogOverrides, TRANSLATION_OVERRIDES_FILENAME } = require('../dist/index.js')

async function makeTempProject() {
  return mkdtemp(join(tmpdir(), 'mpx-core-overrides-test-'))
}

test('parseCatalogOverrides accepts a well-formed per-language override map', () => {
  const { overrides, issues } = parseCatalogOverrides({
    fr: { 'Skill.Perception': 'Vigilance' },
    en: { 'Unit.Hour': { one: 'Turn', many: 'Turns' } },
  })
  assert.deepEqual(issues, [])
  assert.equal(overrides.fr['Skill.Perception'], 'Vigilance')
  assert.deepEqual(overrides.en['Unit.Hour'], { one: 'Turn', many: 'Turns' })
})

test('parseCatalogOverrides reports (and skips) an unrecognized language key', () => {
  const { overrides, issues } = parseCatalogOverrides({ de: { 'Common.Source': 'Quelle' } })
  assert.equal(overrides.de, undefined)
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /Unrecognized language "de"/)
})

test('parseCatalogOverrides reports (and skips) a malformed entry without discarding valid ones', () => {
  const { overrides, issues } = parseCatalogOverrides({
    fr: { 'Skill.Perception': 'Vigilance', 'Common.Source': 42 },
  })
  assert.equal(overrides.fr['Skill.Perception'], 'Vigilance')
  assert.equal(overrides.fr['Common.Source'], undefined)
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /"fr.Common.Source"/)
})

test('parseCatalogOverrides silently ignores a "$schema" pointer (editor tooling convention, not a language)', () => {
  const { overrides, issues } = parseCatalogOverrides({
    $schema: './some/schema.json',
    fr: { 'Skill.Perception': 'Vigilance' },
  })
  assert.deepEqual(issues, [])
  assert.equal(overrides.fr['Skill.Perception'], 'Vigilance')
})

test('parseCatalogOverrides rejects a non-object top level', () => {
  const { overrides, issues } = parseCatalogOverrides('not an object')
  assert.deepEqual(overrides, {})
  assert.equal(issues.length, 1)
})

test('loadCatalogOverrides returns empty overrides with no issues when the file is absent', async () => {
  const root = await makeTempProject()
  const { overrides, issues } = await loadCatalogOverrides(root)
  assert.deepEqual(overrides, {})
  assert.deepEqual(issues, [])
})

test('loadCatalogOverrides reads and parses a real translation-overrides.json', async () => {
  const root = await makeTempProject()
  await writeFile(join(root, TRANSLATION_OVERRIDES_FILENAME), JSON.stringify({ fr: { 'Skill.Perception': 'Vigilance' } }))
  const { overrides, issues } = await loadCatalogOverrides(root)
  assert.deepEqual(issues, [])
  assert.equal(overrides.fr['Skill.Perception'], 'Vigilance')
})

test('loadCatalogOverrides reports invalid JSON instead of throwing', async () => {
  const root = await makeTempProject()
  await writeFile(join(root, TRANSLATION_OVERRIDES_FILENAME), '{ not valid json')
  const { overrides, issues } = await loadCatalogOverrides(root)
  assert.deepEqual(overrides, {})
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /Invalid JSON/)
})
