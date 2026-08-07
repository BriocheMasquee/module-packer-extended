const assert = require('node:assert/strict')
const { mkdir, mkdtemp, readdir, readFile, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const { createModuleProject, detectWorkspaceKind } = require('../dist/index.js')

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), 'mpx-core-test-'))
}

async function makeThemeFixture() {
  const themeDirectory = await makeTempDir()
  await mkdir(join(themeDirectory, 'css'))
  await writeFile(join(themeDirectory, 'css', 'global.css'), 'body {}')
  await writeFile(
    join(themeDirectory, 'theme.json'),
    JSON.stringify({ id: 'test-theme', name: 'Test Theme', description: 'A fixture theme.' }),
  )
  return { id: 'test-theme', name: 'Test Theme', description: 'A fixture theme.', themeDirectory }
}

test('detectWorkspaceKind returns empty for an empty folder', async () => {
  const folder = await makeTempDir()
  assert.equal(await detectWorkspaceKind(folder), 'empty')
})

test('detectWorkspaceKind returns mpxProject when module.json is present', async () => {
  const folder = await makeTempDir()
  await writeFile(join(folder, 'module.json'), '{}')
  assert.equal(await detectWorkspaceKind(folder), 'mpxProject')
})

test('detectWorkspaceKind returns unsupported for a non-empty folder without module.json', async () => {
  const folder = await makeTempDir()
  await writeFile(join(folder, 'readme.txt'), 'hello')
  assert.equal(await detectWorkspaceKind(folder), 'unsupported')
})

test('createModuleProject writes module.json, images/, and the theme assets', async () => {
  const folder = await makeTempDir()
  const theme = await makeThemeFixture()

  await createModuleProject(folder, theme)

  const moduleJson = JSON.parse(await readFile(join(folder, 'module.json'), 'utf8'))
  assert.match(moduleJson.id, /^[0-9a-f-]{36}$/)
  assert.equal(moduleJson.version, '1.0.0')
  assert.equal(moduleJson.system, 'dnd5e')

  assert.deepEqual(await readdir(join(folder, 'images')), [])
  assert.deepEqual(await readdir(join(folder, 'assets')), ['css'])
  assert.deepEqual(await readdir(join(folder, 'assets', 'css')), ['global.css'])
})

test('createModuleProject writes .vscode/settings.json with auto-increment and localization defaults', async () => {
  const folder = await makeTempDir()
  const theme = await makeThemeFixture()

  await createModuleProject(folder, theme)

  const settings = JSON.parse(await readFile(join(folder, '.vscode', 'settings.json'), 'utf8'))
  assert.deepEqual(settings, {
    'mpx.projectTheme': 'test-theme',
    'mpx.autoIncrementVersion': true,
    'mpx.contentLanguage': 'en',
    'mpx.defaultMeasurement': 'auto',
    'mpx.defaultAddSpellImageToCompendium': true,
    'mpx.defaultShowSpellSchoolIcon': true,
    'mpx.defaultShowSpellAreaEffectIcon': true,
    'mpx.defaultShowSpellSources': true,
    'mpx.defaultShowSpellTags': true,
    'mpx.defaultAddItemImageToCompendium': true,
    'mpx.defaultShowItemSources': true,
    'mpx.defaultShowItemTags': true,
    'mpx.defaultAddMonsterImageToCompendium': true,
    'mpx.defaultAddMonsterTokenToCompendium': true,
    'mpx.defaultShowMonsterSources': true,
    'mpx.defaultShowMonsterTags': true,
    'mpx.defaultAddBackgroundImageToCompendium': true,
    'mpx.defaultShowBackgroundSources': true,
    'mpx.defaultShowBackgroundTags': true,
    'mpx.autoDetectRollTables': true,
  })
})

test('createModuleProject writes every module.json field the EncounterPlus schema defines', async () => {
  const folder = await makeTempDir()
  const theme = await makeThemeFixture()

  await createModuleProject(folder, theme)

  const moduleJson = JSON.parse(await readFile(join(folder, 'module.json'), 'utf8'))
  assert.deepEqual(Object.keys(moduleJson).sort(), [
    'acronym',
    'author',
    'banner',
    'category',
    'descr',
    'id',
    'image',
    'name',
    'package',
    'repository',
    'shortDescr',
    'slug',
    'system',
    'tags',
    'version',
    'website',
  ])
})

test('createModuleProject refuses a non-empty folder', async () => {
  const folder = await makeTempDir()
  const theme = await makeThemeFixture()
  await writeFile(join(folder, 'existing.txt'), 'already here')

  await assert.rejects(() => createModuleProject(folder, theme), /must be empty/)
})
