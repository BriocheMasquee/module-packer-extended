const assert = require('node:assert/strict')
const { mkdir, mkdtemp, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const { findInlineItems } = require('../dist/index.js')

async function makeTempModule() {
  return mkdtemp(join(tmpdir(), 'mpx-core-inline-item-scan-test-'))
}

test('findInlineItems finds an item block inside a page and reports its line', async () => {
  const root = await makeTempModule()
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    ['---', 'name: Introduction', 'slug: intro', 'rank: 0', '---', '', 'Some text.', '', '```item', 'name: Ring of Protection', '```', ''].join(
      '\n',
    ),
  )

  const results = await findInlineItems(root)

  assert.equal(results.length, 1)
  assert.equal(results[0].name, 'Ring of Protection')
  assert.equal(results[0].pageFilePath, join(root, 'pages', 'intro.md'))
  assert.equal(results[0].line, 8)
})

test('findInlineItems finds multiple item blocks across multiple pages', async () => {
  const root = await makeTempModule()
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'a.md'),
    ['---', 'name: A', 'slug: a', 'rank: 0', '---', '', '```item', 'name: Longsword', '```', ''].join('\n'),
  )
  await writeFile(
    join(root, 'pages', 'b.md'),
    ['---', 'name: B', 'slug: b', 'rank: 1', '---', '', '```item', 'name: Shield', '```', ''].join('\n'),
  )

  const results = await findInlineItems(root)

  assert.equal(results.length, 2)
  assert.deepEqual(
    results.map((r) => r.name).sort(),
    ['Longsword', 'Shield'],
  )
})

test('findInlineItems returns an empty array when there are no pages or item blocks', async () => {
  const root = await makeTempModule()

  const results = await findInlineItems(root)

  assert.deepEqual(results, [])
})

test('findInlineItems skips a malformed item block instead of throwing', async () => {
  const root = await makeTempModule()
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    ['---', 'name: Introduction', 'slug: intro', 'rank: 0', '---', '', '```item', 'name: [unterminated', '```', ''].join('\n'),
  )

  const results = await findInlineItems(root)

  assert.deepEqual(results, [])
})

test('findInlineItems does not pick up an inline spell block', async () => {
  const root = await makeTempModule()
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    ['---', 'name: Introduction', 'slug: intro', 'rank: 0', '---', '', '```spell', 'name: Fireball', '```', ''].join('\n'),
  )

  const results = await findInlineItems(root)

  assert.deepEqual(results, [])
})
