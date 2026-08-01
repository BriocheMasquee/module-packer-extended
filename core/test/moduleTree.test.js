const assert = require('node:assert/strict')
const { mkdir, mkdtemp, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const { parseModuleTree } = require('../dist/index.js')

async function makeTempModule() {
  return mkdtemp(join(tmpdir(), 'mpx-core-tree-test-'))
}

function pageContent({ name, slug, rank, parent }) {
  const front = [
    '---',
    `name: ${name}`,
    `slug: ${slug}`,
    `rank: ${rank}`,
    parent ? `parent: ${parent}` : undefined,
    '---',
    '',
  ]
    .filter(Boolean)
    .join('\n')
  return front
}

test('parseModuleTree nests pages by parent slug, sorted by rank then name', async () => {
  const root = await makeTempModule()
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    pageContent({ name: 'Intro', slug: 'intro', rank: 0 }),
  )
  await writeFile(
    join(root, 'pages', 'b-child.md'),
    pageContent({ name: 'B Child', slug: 'b-child', rank: 1, parent: 'intro' }),
  )
  await writeFile(
    join(root, 'pages', 'a-child.md'),
    pageContent({ name: 'A Child', slug: 'a-child', rank: 1, parent: 'intro' }),
  )

  const tree = await parseModuleTree(root)

  assert.equal(tree.length, 1)
  assert.equal(tree[0].name, 'Intro')
  assert.equal(tree[0].children.length, 2)
  assert.deepEqual(
    tree[0].children.map((child) => child.name),
    ['A Child', 'B Child'],
  )
})

test('parseModuleTree treats an ambiguous parent slug as unresolved (child stays at root)', async () => {
  const root = await makeTempModule()
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'dup1.md'),
    pageContent({ name: 'Dup 1', slug: 'dup', rank: 0 }),
  )
  await writeFile(
    join(root, 'pages', 'dup2.md'),
    pageContent({ name: 'Dup 2', slug: 'dup', rank: 1 }),
  )
  await writeFile(
    join(root, 'pages', 'child.md'),
    pageContent({ name: 'Child', slug: 'child', rank: 2, parent: 'dup' }),
  )

  const tree = await parseModuleTree(root)

  assert.equal(tree.length, 3)
  assert.equal(
    tree.every((node) => node.children.length === 0),
    true,
  )
})

test('parseModuleTree breaks a parent cycle by keeping both nodes at the root', async () => {
  const root = await makeTempModule()
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'a.md'),
    pageContent({ name: 'A', slug: 'a', rank: 0, parent: 'b' }),
  )
  await writeFile(
    join(root, 'pages', 'b.md'),
    pageContent({ name: 'B', slug: 'b', rank: 1, parent: 'a' }),
  )

  const tree = await parseModuleTree(root)

  assert.equal(tree.length, 2)
  assert.equal(
    tree.every((node) => node.children.length === 0),
    true,
  )
})

test('parseModuleTree mixes groups, maps, and encounters under a common parent', async () => {
  const root = await makeTempModule()
  await mkdir(join(root, 'pages'), { recursive: true })
  await mkdir(join(root, 'groups'), { recursive: true })
  await mkdir(join(root, 'maps'), { recursive: true })
  await mkdir(join(root, 'encounters'), { recursive: true })

  await writeFile(
    join(root, 'groups', 'chapter-1.json'),
    JSON.stringify({ name: 'Chapter 1', slug: 'chapter-1', rank: 0 }),
  )
  await writeFile(
    join(root, 'maps', 'town.json'),
    JSON.stringify({ slug: 'town-map', rank: 0, parent: 'chapter-1' }),
  )
  await writeFile(
    join(root, 'encounters', 'ambush.json'),
    JSON.stringify({ slug: 'ambush', rank: 1, parent: 'chapter-1' }),
  )

  const tree = await parseModuleTree(root)

  assert.equal(tree.length, 1)
  assert.equal(tree[0].kind, 'group')
  assert.deepEqual(
    tree[0].children.map((child) => [child.kind, child.name]),
    [
      ['map', 'town-map'],
      ['encounter', 'ambush'],
    ],
  )
})

test('parseModuleTree returns an empty tree when there is no content yet', async () => {
  const root = await makeTempModule()
  assert.deepEqual(await parseModuleTree(root), [])
})
