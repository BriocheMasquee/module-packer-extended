const assert = require('node:assert/strict')
const { mkdir, mkdtemp, readFile, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const { analyzeMpProject, convertMpProject } = require('../dist/index.js')

async function makeTempDirs() {
  const root = await mkdtemp(join(tmpdir(), 'mpx-mp-conversion-'))
  const sourceDirectory = join(root, 'Legacy')
  const destinationDirectory = join(root, 'Converted')
  await mkdir(sourceDirectory, { recursive: true })
  return { destinationDirectory, sourceDirectory }
}

test('analyzeMpProject reads Module.yaml metadata, pages, and groups', async () => {
  const { sourceDirectory } = await makeTempDirs()
  await writeFile(
    join(sourceDirectory, 'Module.yaml'),
    `id: f41f33f0-7a63-11ed-89ed-499bb1f405dc
name: Cultist Hideout
slug: cultist-hideout
description: Adventure idea.
category: adventure
author: Derek Ruiz
code: "249"
version: 1
`,
  )
  await writeFile(
    join(sourceDirectory, 'Introduction.md'),
    `---
name: Introduction
slug: introduction
order: 0
---

# Introduction
`,
  )
  await mkdir(join(sourceDirectory, 'Appendices'))
  await writeFile(join(sourceDirectory, 'Appendices', 'Group.yaml'), 'name: Appendices\nslug: appendices\norder: 10\n')
  await writeFile(
    join(sourceDirectory, 'Appendices', 'Rules.md'),
    `---
name: Optional Rules
slug: optional-rules
order: 0
---

Rules text.
`,
  )

  const analysis = await analyzeMpProject(sourceDirectory)
  assert.equal(analysis.module.id, 'f41f33f0-7a63-11ed-89ed-499bb1f405dc')
  assert.equal(analysis.module.name, 'Cultist Hideout')
  assert.equal(analysis.module.author, 'Derek Ruiz')
  assert.equal(analysis.module.acronym, '249')
  assert.equal(analysis.pages.length, 2)
  assert.equal(analysis.groups.length, 1)
  assert.equal(analysis.groups[0].slug, 'appendices')
  const rulesPage = analysis.pages.find((page) => page.slug === 'optional-rules')
  assert.equal(rulesPage.parentSlug, 'appendices')
  assert.equal(rulesPage.parentKind, 'group')
})

test('analyzeMpProject splits a module-pagebreaks page into a page hierarchy', async () => {
  const { sourceDirectory } = await makeTempDirs()
  await writeFile(join(sourceDirectory, 'Module.yaml'), 'id: f41f33f0-7a63-11ed-89ed-499bb1f405dc\nname: Test\nversion: "1.0"\n')
  await writeFile(
    join(sourceDirectory, 'Chapters.md'),
    `---
name: Chapters
slug: chapters
order: 0
module-pagebreaks: h1, h2
---

# First Chapter

First content.

## Child Section

Child content.

# Second Chapter

Second content.
`,
  )

  const analysis = await analyzeMpProject(sourceDirectory)
  assert.equal(analysis.pages.length, 3)
  const first = analysis.pages.find((page) => page.name === 'First Chapter')
  const child = analysis.pages.find((page) => page.name === 'Child Section')
  assert.equal(child.parentSlug, first.slug)
  assert.equal(child.parentKind, 'page')
})

test('analyzeMpProject flags the legacy blockquote decoration and counts compendium blocks', async () => {
  const { sourceDirectory } = await makeTempDirs()
  await writeFile(join(sourceDirectory, 'Module.yaml'), 'id: f41f33f0-7a63-11ed-89ed-499bb1f405dc\nname: Test\nversion: "1.0"\n')
  await writeFile(
    join(sourceDirectory, 'page.md'),
    `---
name: Page
slug: page
order: 0
---

> Text
<!--{blockquote:.red.color-links}-->

\`\`\`Item
name: Test Item
\`\`\`
`,
  )

  const analysis = await analyzeMpProject(sourceDirectory)
  assert.ok(analysis.notices.some((notice) => notice.code === 'legacy-decoration'))
  assert.equal(analysis.compendiumBlockCount, 1)
  assert.ok(analysis.notices.some((notice) => notice.code === 'compendium-blocks-unconverted'))
})

test('convertMpProject writes module.json, pages, groups, images, and settings.json', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  await mkdir(join(sourceDirectory, 'Images'), { recursive: true })
  await writeFile(
    join(sourceDirectory, 'Module.yaml'),
    `id: f41f33f0-7a63-11ed-89ed-499bb1f405dc
name: Legacy Module
slug: legacy-module
description: Legacy description
category: rules
author: Legacy Author
cover: cover.jpg
version: 2.0.0
`,
  )
  await writeFile(join(sourceDirectory, 'cover.jpg'), 'cover')
  await writeFile(
    join(sourceDirectory, 'Introduction.md'),
    `---
name: Introduction
slug: introduction
order: 10
---

# Introduction

![Illustration](Images/illustration.webp)

> **Maps:** something
<!--{blockquote:.red.color-links}-->
`,
  )
  await writeFile(join(sourceDirectory, 'Images', 'illustration.webp'), 'image bytes')
  await mkdir(join(sourceDirectory, 'assets', 'css'), { recursive: true })
  await writeFile(join(sourceDirectory, 'assets', 'css', 'global.css'), 'legacy global')

  const result = await convertMpProject(sourceDirectory, destinationDirectory)

  const moduleJson = JSON.parse(await readFile(join(destinationDirectory, 'module.json'), 'utf8'))
  assert.equal(moduleJson.id, 'F41F33F0-7A63-11ED-89ED-499BB1F405DC')
  assert.equal(moduleJson.name, 'Legacy Module')
  assert.equal(moduleJson.slug, 'legacy-module')
  assert.equal(moduleJson.system, 'dnd5e')
  assert.equal(moduleJson.image, 'cover.jpg')

  const introduction = await readFile(join(destinationDirectory, 'pages', 'introduction.md'), 'utf8')
  assert.match(introduction, /rank: 10/)
  assert.match(introduction, /!\[Illustration\]\(images\/illustration\.webp\)/)
  assert.match(introduction, /\{\.red \.color-links\}/)
  assert.doesNotMatch(introduction, /<!--\{blockquote/)

  assert.equal(
    await readFile(join(destinationDirectory, 'images', 'illustration.webp'), 'utf8'),
    'image bytes',
  )
  assert.equal(await readFile(join(destinationDirectory, 'cover.jpg'), 'utf8'), 'cover')

  assert.equal(
    await readFile(join(destinationDirectory, 'assets', 'css', 'global.css'), 'utf8'),
    'legacy global',
  )

  const settings = JSON.parse(await readFile(join(destinationDirectory, '.vscode', 'settings.json'), 'utf8'))
  assert.equal(settings['mpx.contentLanguage'], 'en')
  assert.equal(settings['mpx.defaultMeasurement'], 'auto')

  assert.equal(result.pageCount, 1)
  assert.equal(result.imageCount, 1)
})

test('convertMpProject preserves the MP module id, uppercased', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  await writeFile(
    join(sourceDirectory, 'Module.yaml'),
    'id: f41f33f0-7a63-11ed-89ed-499bb1f405dc\nname: Test\nversion: "1.0"\n',
  )
  const result = await convertMpProject(sourceDirectory, destinationDirectory)
  assert.equal(result.moduleId, 'F41F33F0-7A63-11ED-89ED-499BB1F405DC')
})

test('convertMpProject generates a fresh id when Module.yaml has none', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  await writeFile(join(sourceDirectory, 'Module.yaml'), 'name: Test\nversion: "1.0"\n')
  const result = await convertMpProject(sourceDirectory, destinationDirectory)
  assert.match(result.moduleId, /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/)
})

test('convertMpProject refuses a non-empty destination', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  await writeFile(join(sourceDirectory, 'Module.yaml'), 'name: Test\nversion: "1.0"\n')
  await mkdir(destinationDirectory, { recursive: true })
  await writeFile(join(destinationDirectory, 'existing.txt'), 'x')
  await assert.rejects(convertMpProject(sourceDirectory, destinationDirectory), /must be empty/)
})

test('convertMpProject refuses a destination inside the MP source project', async () => {
  const { sourceDirectory } = await makeTempDirs()
  await writeFile(join(sourceDirectory, 'Module.yaml'), 'name: Test\nversion: "1.0"\n')
  await assert.rejects(
    convertMpProject(sourceDirectory, join(sourceDirectory, 'nested')),
    /outside the MP source project/,
  )
})

test('convertMpProject carries an inline Item block through as unmodified page text', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  await writeFile(join(sourceDirectory, 'Module.yaml'), 'name: Test\nversion: "1.0"\n')
  await writeFile(
    join(sourceDirectory, 'page.md'),
    `---
name: Page
slug: page
order: 0
---

\`\`\`Item
name: Bâton illustré
rarity: Common
type: Weapon
description: Objet de test.
\`\`\`
`,
  )
  await convertMpProject(sourceDirectory, destinationDirectory)
  const page = await readFile(join(destinationDirectory, 'pages', 'page.md'), 'utf8')
  assert.match(page, /rarity: Common/)
  assert.match(page, /description: Objet de test\./)
})
