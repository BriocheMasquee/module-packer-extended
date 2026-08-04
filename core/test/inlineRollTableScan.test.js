const assert = require('node:assert/strict')
const { mkdir, mkdtemp, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const { findInlineRollTables } = require('../dist/index.js')

async function makeTempModule() {
  return mkdtemp(join(tmpdir(), 'mpx-core-inline-scan-test-'))
}

test('findInlineRollTables finds a roll table inside a page and reports its line', async () => {
  const root = await makeTempModule()
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      '---',
      '',
      'Some text.',
      '',
      '|[2d6](/roll/2d6)|Encounter|',
      '|:---:|:---|',
      '|2-3|3 Kobolds|',
      '',
    ].join('\n'),
  )

  const results = await findInlineRollTables(root)

  assert.equal(results.length, 1)
  assert.equal(results[0].name, 'Introduction — Encounter')
  assert.equal(results[0].pageFilePath, join(root, 'pages', 'intro.md'))
  assert.equal(results[0].line, 8)
})

test('findInlineRollTables ignores a plain table with no /roll/ link', async () => {
  const root = await makeTempModule()
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    ['---', 'name: Introduction', 'slug: intro', 'rank: 0', '---', '', '|A|B|', '|---|---|', '|1|2|', ''].join('\n'),
  )

  const results = await findInlineRollTables(root)

  assert.deepEqual(results, [])
})

test('findInlineRollTables returns an empty array when there are no pages', async () => {
  const root = await makeTempModule()

  const results = await findInlineRollTables(root)

  assert.deepEqual(results, [])
})
