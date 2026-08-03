const assert = require('node:assert/strict')
const { mkdir, mkdtemp, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const { findInlineMonsters } = require('../dist/index.js')

async function makeTempModule() {
  return mkdtemp(join(tmpdir(), 'mpx-core-inline-monster-scan-test-'))
}

test('findInlineMonsters finds a monster block inside a page and reports its line', async () => {
  const root = await makeTempModule()
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    ['---', 'name: Introduction', 'slug: intro', 'rank: 0', '---', '', 'Some text.', '', '```monster', 'name: Goblin', '```', ''].join(
      '\n',
    ),
  )

  const results = await findInlineMonsters(root)

  assert.equal(results.length, 1)
  assert.equal(results[0].name, 'Goblin')
  assert.equal(results[0].pageFilePath, join(root, 'pages', 'intro.md'))
  assert.equal(results[0].line, 8)
})

test('findInlineMonsters finds multiple monster blocks across multiple pages', async () => {
  const root = await makeTempModule()
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'a.md'),
    ['---', 'name: A', 'slug: a', 'rank: 0', '---', '', '```monster', 'name: Owlbear', '```', ''].join('\n'),
  )
  await writeFile(
    join(root, 'pages', 'b.md'),
    ['---', 'name: B', 'slug: b', 'rank: 1', '---', '', '```monster', 'name: Beholder', '```', ''].join('\n'),
  )

  const results = await findInlineMonsters(root)

  assert.equal(results.length, 2)
  assert.deepEqual(
    results.map((r) => r.name).sort(),
    ['Beholder', 'Owlbear'],
  )
})

test('findInlineMonsters returns an empty array when there are no pages or monster blocks', async () => {
  const root = await makeTempModule()

  const results = await findInlineMonsters(root)

  assert.deepEqual(results, [])
})

test('findInlineMonsters skips a malformed monster block instead of throwing', async () => {
  const root = await makeTempModule()
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    ['---', 'name: Introduction', 'slug: intro', 'rank: 0', '---', '', '```monster', 'name: [unterminated', '```', ''].join('\n'),
  )

  const results = await findInlineMonsters(root)

  assert.deepEqual(results, [])
})

test('findInlineMonsters does not pick up an inline spell or item block', async () => {
  const root = await makeTempModule()
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    ['---', 'name: Introduction', 'slug: intro', 'rank: 0', '---', '', '```spell', 'name: Fireball', '```', '', '```item', 'name: Shield', '```', ''].join(
      '\n',
    ),
  )

  const results = await findInlineMonsters(root)

  assert.deepEqual(results, [])
})
