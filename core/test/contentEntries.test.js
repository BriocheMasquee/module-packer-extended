const assert = require('node:assert/strict')
const { mkdtemp, readFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const {
  createPage,
  createGroup,
  createMapReference,
  createEncounterReference,
} = require('../dist/index.js')

async function makeTempModule() {
  return mkdtemp(join(tmpdir(), 'mpx-core-content-test-'))
}

test('createPage writes a Markdown page with front matter and rank 0', async () => {
  const root = await makeTempModule()
  const result = await createPage(root, 'New Page')

  assert.equal(result.slug, 'new-page')
  const content = await readFile(result.filePath, 'utf8')
  assert.match(content, /^---\nname: New Page\nslug: new-page\nrank: 0\nparent:\n---\n$/)
})

test('createPage refuses to overwrite an existing slug', async () => {
  const root = await makeTempModule()
  await createPage(root, 'Duplicate')
  await assert.rejects(() => createPage(root, 'Duplicate'), /already exists/)
})

test('createGroup writes a JSON group file with empty parent', async () => {
  const root = await makeTempModule()
  const result = await createGroup(root, 'New Group')

  const data = JSON.parse(await readFile(result.filePath, 'utf8'))
  assert.deepEqual(data, { name: 'New Group', slug: 'new-group', rank: 0, parent: '' })
})

test('createMapReference writes a JSON file with path and descr fields', async () => {
  const root = await makeTempModule()
  const result = await createMapReference(root, 'Town Map')

  const data = JSON.parse(await readFile(result.filePath, 'utf8'))
  assert.deepEqual(data, {
    name: 'Town Map',
    slug: 'town-map',
    rank: 0,
    parent: '',
    path: 'maps/',
    descr: '',
  })
})

test('createEncounterReference writes a JSON file with path and descr fields', async () => {
  const root = await makeTempModule()
  const result = await createEncounterReference(root, 'Ambush')

  const data = JSON.parse(await readFile(result.filePath, 'utf8'))
  assert.deepEqual(data, {
    name: 'Ambush',
    slug: 'ambush',
    rank: 0,
    parent: '',
    path: 'encounters/',
    descr: '',
  })
})
