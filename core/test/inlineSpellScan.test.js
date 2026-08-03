const assert = require('node:assert/strict')
const { mkdir, mkdtemp, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const { findInlineSpells } = require('../dist/index.js')

async function makeTempModule() {
  return mkdtemp(join(tmpdir(), 'mpx-core-inline-scan-test-'))
}

test('findInlineSpells finds a spell block inside a page and reports its line', async () => {
  const root = await makeTempModule()
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    ['---', 'name: Introduction', 'slug: intro', 'rank: 0', '---', '', 'Some text.', '', '```spell', 'name: Fireball', '```', ''].join(
      '\n',
    ),
  )

  const results = await findInlineSpells(root)

  assert.equal(results.length, 1)
  assert.equal(results[0].name, 'Fireball')
  assert.equal(results[0].pageFilePath, join(root, 'pages', 'intro.md'))
  assert.equal(results[0].line, 8)
})

test('findInlineSpells finds multiple spell blocks across multiple pages', async () => {
  const root = await makeTempModule()
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'a.md'),
    ['---', 'name: A', 'slug: a', 'rank: 0', '---', '', '```spell', 'name: Aid', '```', ''].join('\n'),
  )
  await writeFile(
    join(root, 'pages', 'b.md'),
    ['---', 'name: B', 'slug: b', 'rank: 1', '---', '', '```spell', 'name: Blade Ward', '```', ''].join('\n'),
  )

  const results = await findInlineSpells(root)

  assert.equal(results.length, 2)
  assert.deepEqual(
    results.map((r) => r.name).sort(),
    ['Aid', 'Blade Ward'],
  )
})

test('findInlineSpells returns an empty array when there are no pages or spell blocks', async () => {
  const root = await makeTempModule()

  const results = await findInlineSpells(root)

  assert.deepEqual(results, [])
})

test('findInlineSpells skips a malformed spell block instead of throwing', async () => {
  const root = await makeTempModule()
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    ['---', 'name: Introduction', 'slug: intro', 'rank: 0', '---', '', '```spell', 'name: [unterminated', '```', ''].join('\n'),
  )

  const results = await findInlineSpells(root)

  assert.deepEqual(results, [])
})
