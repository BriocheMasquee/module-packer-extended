const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { createWriteStream } = require('node:fs')
const { mkdir, mkdtemp, readFile, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { basename, join } = require('node:path')
const test = require('node:test')
const { ZipFile } = require('yazl')

const { buildModule, ModuleBuildError } = require('../dist/index.js')

async function makeTempModule() {
  return mkdtemp(join(tmpdir(), 'mpx-core-build-test-'))
}

function readZipEntry(archivePath, entryName) {
  return execFileSync('unzip', ['-p', archivePath, entryName], { encoding: 'utf8' })
}

function listZipEntries(archivePath) {
  return execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' }).trim().split('\n')
}

async function writeValidModule(root, { id } = {}) {
  await writeFile(
    join(root, 'module.json'),
    JSON.stringify({
      ...(id ? { id } : {}),
      name: 'Test Module',
      slug: 'test-module',
      system: 'dnd5e',
      version: '1.0.0',
    }),
  )
}

/** Builds a real EncounterPlus map/encounter export zip, matching the format
 * buildModule expects: a single-object manifest plus optional resources. */
async function writeExportArchive(destPath, manifestFileName, record, resources = {}) {
  await new Promise((resolvePromise, rejectPromise) => {
    const zip = new ZipFile()
    zip.addBuffer(Buffer.from(JSON.stringify([record])), manifestFileName)
    for (const [name, content] of Object.entries(resources)) {
      zip.addBuffer(Buffer.from(content), name)
    }
    zip.outputStream.pipe(createWriteStream(destPath)).on('close', resolvePromise).on('error', rejectPromise)
    zip.end()
  })
}

test('buildModule writes a .module archive with resolved ids and rendered page content', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await mkdir(join(root, 'groups'), { recursive: true })
  await writeFile(
    join(root, 'groups', 'chapter-1.json'),
    JSON.stringify({ name: 'Chapter 1', slug: 'chapter-1', rank: 0, parent: '' }),
  )
  await writeFile(
    join(root, 'pages', 'intro.md'),
    '---\nname: Introduction\nslug: intro\nrank: 0\nparent: chapter-1\n---\n\n# Hello\n\nSome **bold** text.\n',
  )

  const summary = await buildModule(root)

  assert.equal(summary.outputPath, join(root, `${basename(root)}.module`))
  assert.equal(summary.pageCount, 1)
  assert.equal(summary.groupCount, 1)

  const pages = JSON.parse(readZipEntry(summary.outputPath, 'pages.json'))
  const groups = JSON.parse(readZipEntry(summary.outputPath, 'groups.json'))

  assert.equal(pages.length, 1)
  assert.match(pages[0].id, /^[0-9a-f-]{36}$/)
  assert.equal(pages[0].parentId, groups[0].id)
  assert.match(pages[0].content, /<h1[^>]*>Hello<\/h1>/)
  assert.match(pages[0].content, /<strong>bold<\/strong>/)
})

test('buildModule generates and persists a module id when missing', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)

  await buildModule(root)

  const moduleJson = JSON.parse(await readFile(join(root, 'module.json'), 'utf8'))
  assert.match(moduleJson.id, /^[0-9a-f-]{36}$/)
})

test('buildModule bumps the patch version after a successful build when autoIncrementVersion is set', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)

  const summary = await buildModule(root, { autoIncrementVersion: true })

  const builtModuleJson = JSON.parse(readZipEntry(summary.outputPath, 'module.json'))
  assert.equal(builtModuleJson.version, '1.0.0', 'the archive keeps the version it was built with')

  const projectModuleJson = JSON.parse(await readFile(join(root, 'module.json'), 'utf8'))
  assert.equal(projectModuleJson.version, '1.0.1', 'the project file is bumped for the next build')

  assert.equal(summary.builtVersion, '1.0.0')
  assert.equal(summary.nextVersion, '1.0.1')
})

test('buildModule leaves the version untouched when autoIncrementVersion is not set', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)

  const summary = await buildModule(root)

  const projectModuleJson = JSON.parse(await readFile(join(root, 'module.json'), 'utf8'))
  assert.equal(projectModuleJson.version, '1.0.0')
  assert.equal(summary.builtVersion, '1.0.0')
  assert.equal(summary.nextVersion, undefined)
})

test('buildModule collects every validation issue instead of stopping at the first one', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(join(root, 'pages', 'no-slug.md'), '---\nname: No Slug\nrank: 0\n---\n')
  await writeFile(join(root, 'pages', 'no-name.md'), '---\nslug: no-name\nrank: 0\n---\n')

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.equal(error.issues.length, 2)
      return true
    },
  )
})

test('buildModule fails clearly when module.json is missing', async () => {
  const root = await makeTempModule()

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.equal(error.issues.length, 1)
      assert.match(error.issues[0].message, /missing/)
      return true
    },
  )
})

test('buildModule includes images and assets in the archive', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'images'), { recursive: true })
  await mkdir(join(root, 'assets', 'css'), { recursive: true })
  await writeFile(join(root, 'images', 'cover.png'), 'fake-png-bytes')
  await writeFile(join(root, 'assets', 'css', 'global.css'), 'body {}')

  const summary = await buildModule(root)

  const entries = listZipEntries(summary.outputPath)
  assert.ok(entries.includes('images/cover.png'))
  assert.ok(entries.includes('assets/css/global.css'))
})

test('buildModule excludes .DS_Store files from images/assets', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'images'), { recursive: true })
  await writeFile(join(root, 'images', '.DS_Store'), 'not-a-real-file')

  const summary = await buildModule(root)

  assert.ok(!listZipEntries(summary.outputPath).includes('images/.DS_Store'))
})

test('buildModule never bundles translation-overrides.json, even if dropped inside assets/', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await writeFile(join(root, 'translation-overrides.json'), JSON.stringify({ fr: {} }))
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'assets', 'translation-overrides.json'), JSON.stringify({ fr: {} }))

  const summary = await buildModule(root)

  const entries = listZipEntries(summary.outputPath)
  assert.ok(!entries.some((entry) => entry.endsWith('translation-overrides.json')))
})

test('buildModule bundles the module.json image/banner files at the archive root', async () => {
  const root = await makeTempModule()
  await writeFile(
    join(root, 'module.json'),
    JSON.stringify({
      name: 'Test Module',
      slug: 'test-module',
      system: 'dnd5e',
      version: '1.0.0',
      image: 'cover.png',
      banner: 'banner.png',
    }),
  )
  await writeFile(join(root, 'cover.png'), 'fake-cover-bytes')
  await writeFile(join(root, 'banner.png'), 'fake-banner-bytes')

  const summary = await buildModule(root)

  const entries = listZipEntries(summary.outputPath)
  assert.ok(entries.includes('cover.png'))
  assert.ok(entries.includes('banner.png'))
})

test('buildModule rejects a module.json that references a missing image', async () => {
  const root = await makeTempModule()
  await writeFile(
    join(root, 'module.json'),
    JSON.stringify({
      name: 'Test Module',
      slug: 'test-module',
      system: 'dnd5e',
      version: '1.0.0',
      image: 'images/cover.png',
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.equal(error.issues.length, 1)
      assert.match(error.issues[0].message, /"image" references a missing file/)
      return true
    },
  )
})

test('buildModule rejects a module.json that references a missing banner', async () => {
  const root = await makeTempModule()
  await writeFile(
    join(root, 'module.json'),
    JSON.stringify({
      name: 'Test Module',
      slug: 'test-module',
      system: 'dnd5e',
      version: '1.0.0',
      banner: 'images/banner.png',
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.equal(error.issues.length, 1)
      assert.match(error.issues[0].message, /"banner" references a missing file/)
      return true
    },
  )
})

test('buildModule rejects a resource path that escapes the project (path traversal)', async () => {
  const root = await makeTempModule()
  await writeFile(
    join(root, 'module.json'),
    JSON.stringify({
      name: 'Test Module',
      slug: 'test-module',
      system: 'dnd5e',
      version: '1.0.0',
      image: '../../etc/passwd',
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.equal(error.issues.length, 1)
      assert.match(error.issues[0].message, /outside the project/)
      return true
    },
  )
})

test('buildModule rejects a module.json slug containing spaces or accents', async () => {
  const root = await makeTempModule()
  await writeFile(
    join(root, 'module.json'),
    JSON.stringify({
      name: 'Test Module',
      slug: 'Módule Slug',
      system: 'dnd5e',
      version: '1.0.0',
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.equal(error.issues.length, 1)
      assert.match(error.issues[0].message, /"slug" must contain only lowercase letters/)
      return true
    },
  )
})

test('buildModule rejects a page slug containing spaces or accents', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(join(root, 'pages', 'a.md'), '---\nname: A\nslug: bad slug\nrank: 0\n---\n')

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.equal(error.issues.length, 1)
      assert.match(error.issues[0].message, /slug must contain only lowercase letters/)
      return true
    },
  )
})

test('buildModule rejects a map slug containing spaces or accents', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'maps'), { recursive: true })
  await writeExportArchive(join(root, 'maps', 'export.zip'), 'maps.json', { slug: 'town', rank: 0 })
  await writeFile(
    join(root, 'maps', 'town.json'),
    JSON.stringify({ slug: 'bad slug', rank: 0, parent: '', path: 'maps/export.zip', descr: '' }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.equal(error.issues.length, 1)
      assert.match(error.issues[0].message, /slug must contain only lowercase letters/)
      return true
    },
  )
})

test('buildModule strips empty optional module.json fields from the built archive, keeping the project file exhaustive', async () => {
  const root = await makeTempModule()
  await writeFile(
    join(root, 'module.json'),
    JSON.stringify({
      name: 'Test Module',
      slug: 'test-module',
      system: 'dnd5e',
      version: '1.0.0',
      acronym: '',
      category: '',
      author: '',
      shortDescr: '',
      descr: '',
      tags: [],
      image: '',
      banner: '',
      website: '',
      repository: '',
      package: '',
    }),
  )

  const summary = await buildModule(root)

  const builtModuleJson = JSON.parse(readZipEntry(summary.outputPath, 'module.json'))
  for (const field of [
    'acronym',
    'category',
    'author',
    'shortDescr',
    'descr',
    'tags',
    'image',
    'banner',
    'website',
    'repository',
    'package',
  ]) {
    assert.ok(!(field in builtModuleJson), `expected "${field}" to be absent from the built module.json`)
  }

  const projectModuleJson = JSON.parse(await readFile(join(root, 'module.json'), 'utf8'))
  assert.ok('category' in projectModuleJson, 'the project file keeps every field for editing')
})

test('buildModule rejects an invalid module.json category', async () => {
  const root = await makeTempModule()
  await writeFile(
    join(root, 'module.json'),
    JSON.stringify({
      name: 'Test Module',
      slug: 'test-module',
      system: 'dnd5e',
      version: '1.0.0',
      category: 'not-a-real-category',
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.equal(error.issues.length, 1)
      assert.match(error.issues[0].message, /"category" must be one of/)
      return true
    },
  )
})

test('buildModule rejects module.json tags that are not an array of strings', async () => {
  const root = await makeTempModule()
  await writeFile(
    join(root, 'module.json'),
    JSON.stringify({
      name: 'Test Module',
      slug: 'test-module',
      system: 'dnd5e',
      version: '1.0.0',
      tags: ['ok', 42],
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.equal(error.issues.length, 1)
      assert.match(error.issues[0].message, /"tags" must be an array of strings/)
      return true
    },
  )
})

test('buildModule accepts a minimal map export with no image/floor resource', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'maps'), { recursive: true })
  await writeExportArchive(join(root, 'maps', 'export.zip'), 'maps.json', {
    id: 'AE4C6A26-7F11-4940-95DB-8E7BD5A5100C',
    name: 'New Map',
    slug: 'new-map',
    rank: 0,
    parentId: '',
    descr: '',
    gridSize: 50,
  })
  await writeFile(
    join(root, 'maps', 'town.json'),
    JSON.stringify({ slug: 'town', rank: 0, parent: '', path: 'maps/export.zip', descr: '' }),
  )

  const summary = await buildModule(root)

  assert.equal(summary.mapCount, 1)
  const maps = JSON.parse(readZipEntry(summary.outputPath, 'maps.json'))
  assert.equal(maps[0].slug, 'town')
  assert.equal(maps[0].gridSize, 50)
  assert.match(maps[0].id, /^[0-9a-f-]{36}$/)
})

test('buildModule accepts a minimal encounter export', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'encounters'), { recursive: true })
  await writeExportArchive(join(root, 'encounters', 'export.zip'), 'encounters.json', {
    id: '89BFECD5-DCC0-4DE0-B706-A49648E3EA0A',
    name: 'Rencontre',
    slug: 'rencontre',
    rank: 0,
    parentId: '',
    descr: '',
  })
  await writeFile(
    join(root, 'encounters', 'ambush.json'),
    JSON.stringify({ slug: 'ambush', rank: 0, parent: '', path: 'encounters/export.zip', descr: '' }),
  )

  const summary = await buildModule(root)

  assert.equal(summary.encounterCount, 1)
  const encounters = JSON.parse(readZipEntry(summary.outputPath, 'encounters.json'))
  assert.equal(encounters[0].slug, 'ambush')
})

test('buildModule bundles a map export image resource at the archive root', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'maps'), { recursive: true })
  await writeExportArchive(
    join(root, 'maps', 'export.zip'),
    'maps.json',
    { slug: 'town', rank: 0, image: 'background.jpg' },
    { 'background.jpg': 'fake-image-bytes' },
  )
  await writeFile(
    join(root, 'maps', 'town.json'),
    JSON.stringify({ slug: 'town', rank: 0, parent: '', path: 'maps/export.zip', descr: '' }),
  )

  const summary = await buildModule(root)

  assert.ok(listZipEntries(summary.outputPath).includes('background.jpg'))
})

test('buildModule rejects a map export whose declared image resource is missing', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'maps'), { recursive: true })
  await writeExportArchive(join(root, 'maps', 'export.zip'), 'maps.json', {
    slug: 'town',
    rank: 0,
    image: 'background.jpg',
  })
  await writeFile(
    join(root, 'maps', 'town.json'),
    JSON.stringify({ slug: 'town', rank: 0, parent: '', path: 'maps/export.zip', descr: '' }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.equal(error.issues.length, 1)
      assert.match(error.issues[0].message, /missing map resource "background.jpg"/)
      return true
    },
  )
})

test('buildModule rejects a resource name collision between two exports', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'maps'), { recursive: true })
  await writeExportArchive(
    join(root, 'maps', 'export-a.zip'),
    'maps.json',
    { slug: 'town-a', rank: 0 },
    { 'shared.png': 'bytes-a' },
  )
  await writeExportArchive(
    join(root, 'maps', 'export-b.zip'),
    'maps.json',
    { slug: 'town-b', rank: 1 },
    { 'shared.png': 'bytes-b' },
  )
  await writeFile(
    join(root, 'maps', 'a.json'),
    JSON.stringify({ slug: 'town-a', rank: 0, parent: '', path: 'maps/export-a.zip', descr: '' }),
  )
  await writeFile(
    join(root, 'maps', 'b.json'),
    JSON.stringify({ slug: 'town-b', rank: 1, parent: '', path: 'maps/export-b.zip', descr: '' }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.equal(error.issues.length, 1)
      assert.match(error.issues[0].message, /Export resource collision for "shared.png"/)
      return true
    },
  )
})

test('buildModule rejects an export resource whose name conflicts with a reserved module file', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'maps'), { recursive: true })
  await writeExportArchive(
    join(root, 'maps', 'export.zip'),
    'maps.json',
    { slug: 'town', rank: 0 },
    { 'images/sneaky.png': 'bytes' },
  )
  await writeFile(
    join(root, 'maps', 'town.json'),
    JSON.stringify({ slug: 'town', rank: 0, parent: '', path: 'maps/export.zip', descr: '' }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.equal(error.issues.length, 1)
      assert.match(error.issues[0].message, /conflicts with another module resource/)
      return true
    },
  )
})

test('buildModule rejects a map/encounter export that is not a valid zip', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'maps'), { recursive: true })
  await writeFile(join(root, 'maps', 'export.zip'), 'not a real zip file')
  await writeFile(
    join(root, 'maps', 'town.json'),
    JSON.stringify({ slug: 'town', rank: 0, parent: '', path: 'maps/export.zip', descr: '' }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.equal(error.issues.length, 1)
      assert.match(error.issues[0].message, /not a readable export archive/)
      return true
    },
  )
})

test('buildModule rejects a map/encounter reference with no path', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'maps'), { recursive: true })
  await writeFile(
    join(root, 'maps', 'town.json'),
    JSON.stringify({ slug: 'town', rank: 0, parent: '', path: 'maps/', descr: '' }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.equal(error.issues.length, 1)
      assert.match(error.issues[0].message, /not a readable export archive/)
      return true
    },
  )
})

test('buildModule rejects a page/group that references an unknown parent slug', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    '---\nname: Intro\nslug: intro\nrank: 0\nparent: does-not-exist\n---\n',
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.equal(error.issues.length, 1)
      assert.match(error.issues[0].message, /unknown parent slug "does-not-exist"/)
      return true
    },
  )
})

test('buildModule rejects a map used as the parent of another entry', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'maps'), { recursive: true })
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeExportArchive(join(root, 'maps', 'export.zip'), 'maps.json', { slug: 'town', rank: 0 })
  await writeFile(
    join(root, 'maps', 'town.json'),
    JSON.stringify({ slug: 'town', rank: 0, parent: '', path: 'maps/export.zip', descr: '' }),
  )
  await writeFile(
    join(root, 'pages', 'intro.md'),
    '---\nname: Intro\nslug: intro\nrank: 0\nparent: town\n---\n',
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.equal(error.issues.length, 1)
      assert.match(error.issues[0].message, /maps and encounters cannot be parents/)
      return true
    },
  )
})

test('buildModule rejects a duplicate slug across entry types', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await mkdir(join(root, 'groups'), { recursive: true })
  await writeFile(join(root, 'pages', 'a.md'), '---\nname: A\nslug: dup\nrank: 0\n---\n')
  await writeFile(join(root, 'groups', 'b.json'), JSON.stringify({ name: 'B', slug: 'dup', rank: 0, parent: '' }))

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.equal(error.issues.length, 1)
      assert.match(error.issues[0].message, /Duplicate page, group, map, or encounter slug "dup"/)
      return true
    },
  )
})

test('buildModule rejects a parent cycle', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(join(root, 'pages', 'a.md'), '---\nname: A\nslug: a\nrank: 0\nparent: b\n---\n')
  await writeFile(join(root, 'pages', 'b.md'), '---\nname: B\nslug: b\nrank: 0\nparent: a\n---\n')

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.ok(error.issues.some((issue) => issue.message.includes('parent cycle detected')))
      return true
    },
  )
})

test('buildModule omits items.json when there are no items', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)

  const summary = await buildModule(root)

  assert.equal(summary.itemCount, 0)
  assert.ok(!listZipEntries(summary.outputPath).includes('items.json'))
})

test('buildModule writes items.json and copies referenced item images', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'items'), { recursive: true })
  await writeFile(join(root, 'items', 'cover.png'), 'fake-image-bytes')
  await writeFile(
    join(root, 'items', 'longsword.json'),
    JSON.stringify({
      id: '9D36046F-200E-44A4-ADBE-64521193DAFF',
      name: 'Longsword',
      slug: 'longsword',
      attributes: { measurement: '', ruleset: '' },
      data: {
        type: 'meleeWeapon',
        rarity: 'common',
        properties: ['versatile'],
        dmg1: '1d8',
        dmg2: '1d10',
      },
      descr: '',
      image: 'items/cover.png',
      sources: [],
      tags: [],
    }),
  )

  const summary = await buildModule(root)

  assert.equal(summary.itemCount, 1)
  const items = JSON.parse(readZipEntry(summary.outputPath, 'items.json'))
  assert.equal(items.length, 1)
  assert.equal(items[0].name, 'Longsword')
  assert.equal(items[0].slug, 'longsword')
  assert.ok(listZipEntries(summary.outputPath).includes('items/cover.png'))
})

test('buildModule rejects an item with an invalid id', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'items'), { recursive: true })
  await writeFile(
    join(root, 'items', 'bad.json'),
    JSON.stringify({ id: 'not-a-uuid', name: 'Bad', slug: 'bad' }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.ok(error.issues.some((issue) => issue.message.includes('valid UUID')))
      return true
    },
  )
})

test('buildModule rejects an item with an unrecognized data.type', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'items'), { recursive: true })
  await writeFile(
    join(root, 'items', 'weird.json'),
    JSON.stringify({
      id: '9D36046F-200E-44A4-ADBE-64521193DAFF',
      name: 'Weird',
      slug: 'weird',
      data: { type: 'notAType' },
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.ok(error.issues.some((issue) => issue.message.includes('not a recognized item type')))
      return true
    },
  )
})

test('buildModule rejects duplicate item ids and slugs', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'items'), { recursive: true })
  await writeFile(
    join(root, 'items', 'a.json'),
    JSON.stringify({ id: '9D36046F-200E-44A4-ADBE-64521193DAFF', name: 'A', slug: 'dup-item' }),
  )
  await writeFile(
    join(root, 'items', 'b.json'),
    JSON.stringify({ id: '9D36046F-200E-44A4-ADBE-64521193DAFF', name: 'B', slug: 'dup-item' }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.ok(error.issues.some((issue) => issue.message.includes('Duplicate item id')))
      assert.ok(error.issues.some((issue) => issue.message.includes('Duplicate item slug')))
      return true
    },
  )
})

test('buildModule rejects an item image path outside the items folder', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'items'), { recursive: true })
  await writeFile(
    join(root, 'items', 'a.json'),
    JSON.stringify({
      id: '9D36046F-200E-44A4-ADBE-64521193DAFF',
      name: 'A',
      slug: 'a',
      image: 'images/cover.png',
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.ok(error.issues.some((issue) => issue.message.includes('directly inside the items folder')))
      return true
    },
  )
})

test('buildModule allows the "items/" placeholder image with no file', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'items'), { recursive: true })
  await writeFile(
    join(root, 'items', 'a.json'),
    JSON.stringify({ id: '9D36046F-200E-44A4-ADBE-64521193DAFF', name: 'A', slug: 'a', image: 'items/' }),
  )

  const summary = await buildModule(root)
  assert.equal(summary.itemCount, 1)
})

test('buildModule strips empty optional item fields but keeps meaningful defaults', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'items'), { recursive: true })
  await writeFile(
    join(root, 'items', 'exhaustive.json'),
    JSON.stringify({
      id: '9D36046F-200E-44A4-ADBE-64521193DAFF',
      name: 'Exhaustive Item',
      slug: 'exhaustive-item',
      attributes: { measurement: '', ruleset: '' },
      data: {
        ac: 0,
        attunement: false,
        attunementDetail: '',
        capacity: 0,
        container: false,
        dmg1: '',
        dmgType: '',
        mastery: '',
        properties: [],
        rarity: '',
        stealth: false,
        str: 0,
        type: 'custom',
        typeDetail: '',
        value: 0,
        weight: 0,
      },
      descr: '',
      image: 'items/',
      sources: [],
      tags: [],
    }),
  )

  const summary = await buildModule(root)
  const items = JSON.parse(readZipEntry(summary.outputPath, 'items.json'))

  assert.equal(items.length, 1)
  const item = items[0]
  assert.deepEqual(item.attributes, { measurement: 'imperial', ruleset: '5.5e' })
  assert.equal(item.descr, undefined)
  assert.equal(item.sources, undefined)
  assert.equal(item.tags, undefined)
  assert.deepEqual(item.data, {
    ac: 0,
    attunement: false,
    capacity: 0,
    container: false,
    stealth: false,
    str: 0,
    type: 'custom',
    value: 0,
    weight: 0,
  })
})

test('buildModule drops a data object that becomes empty after stripping', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'items'), { recursive: true })
  await writeFile(
    join(root, 'items', 'minimal.json'),
    JSON.stringify({
      id: '9D36046F-200E-44A4-ADBE-64521193DAFF',
      name: 'Minimal',
      slug: 'minimal',
      data: { type: '', rarity: '' },
    }),
  )

  const summary = await buildModule(root)
  const items = JSON.parse(readZipEntry(summary.outputPath, 'items.json'))

  assert.equal(items[0].data, undefined)
})

test('buildModule omits spells.json when there are no spells', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)

  const summary = await buildModule(root)

  assert.equal(summary.spellCount, 0)
  assert.ok(!listZipEntries(summary.outputPath).includes('spells.json'))
})

test('buildModule writes spells.json with rangeType/range and duration handled per real EncounterPlus exports', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'spells'), { recursive: true })
  await writeFile(
    join(root, 'spells', 'fireball.json'),
    JSON.stringify({
      id: '9D36046F-200E-44A4-ADBE-64521193DAFF',
      name: 'Fireball',
      slug: 'fireball',
      data: {
        level: 3,
        school: 'evocation',
        ritual: false,
        activation: { time: 1, unit: 'action' },
        range: 150,
        areaEffectShape: 'sphere',
        areaEffectSize: 20,
        components: ['V', 'S', 'M'],
        durationType: 'instantaneous',
        classes: ['Sorcerer|phb-2024', 'Wizard|phb-2024'],
      },
      descr: 'A bright streak flashes.',
    }),
  )
  await writeFile(
    join(root, 'spells', 'guidance.json'),
    JSON.stringify({
      id: 'C696B1C4-CA42-48FF-8120-2395C3DBD013',
      name: 'Guidance',
      slug: 'guidance',
      data: {
        level: 0,
        school: 'divination',
        rangeType: 'touch',
        durationType: 'concentration',
        duration: 1,
        durationUnit: 'minute',
      },
    }),
  )

  const summary = await buildModule(root)

  assert.equal(summary.spellCount, 2)
  const spells = JSON.parse(readZipEntry(summary.outputPath, 'spells.json')).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  assert.equal(spells[0].name, 'Fireball')
  assert.equal(spells[0].data.range, 150)
  assert.equal(spells[0].data.rangeType, undefined)
  assert.deepEqual(spells[0].data.classes, ['Sorcerer|phb-2024', 'Wizard|phb-2024'])
  assert.equal(spells[1].name, 'Guidance')
  assert.equal(spells[1].data.rangeType, 'touch')
  assert.equal(spells[1].data.range, undefined)
  assert.equal(spells[1].data.duration, 1)
  assert.equal(spells[1].data.durationUnit, 'minute')
})

test('buildModule rejects a spell with an unrecognized data.school', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'spells'), { recursive: true })
  await writeFile(
    join(root, 'spells', 'weird.json'),
    JSON.stringify({
      id: '9D36046F-200E-44A4-ADBE-64521193DAFF',
      name: 'Weird',
      slug: 'weird',
      data: { school: 'notASchool' },
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.ok(error.issues.some((issue) => issue.message.includes('not a recognized spell school')))
      return true
    },
  )
})

test('buildModule rejects a spell with a level outside 0-9', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'spells'), { recursive: true })
  await writeFile(
    join(root, 'spells', 'bad.json'),
    JSON.stringify({
      id: '9D36046F-200E-44A4-ADBE-64521193DAFF',
      name: 'Bad',
      slug: 'bad',
      data: { level: 10 },
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.ok(error.issues.some((issue) => issue.message.includes('integer between 0 and 9')))
      return true
    },
  )
})

test('buildModule rejects a spell with an invalid activation.unit', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'spells'), { recursive: true })
  await writeFile(
    join(root, 'spells', 'bad.json'),
    JSON.stringify({
      id: '9D36046F-200E-44A4-ADBE-64521193DAFF',
      name: 'Bad',
      slug: 'bad',
      data: { activation: { time: 1, unit: 'notAUnit' } },
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.ok(error.issues.some((issue) => issue.message.includes('not a recognized activation unit')))
      return true
    },
  )
})

test('buildModule strips empty optional spell fields but keeps meaningful defaults', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'spells'), { recursive: true })
  await writeFile(
    join(root, 'spells', 'exhaustive.json'),
    JSON.stringify({
      id: '9D36046F-200E-44A4-ADBE-64521193DAFF',
      name: 'Exhaustive Spell',
      slug: 'exhaustive-spell',
      attributes: { measurement: '', ruleset: '' },
      data: {
        level: 0,
        school: '',
        ritual: false,
        activation: { time: 0, unit: '', condition: '' },
        rangeType: '',
        range: 0,
        areaEffectShape: '',
        areaEffectSize: 0,
        components: [],
        componentsDetail: '',
        durationType: '',
        duration: 0,
        durationUnit: '',
        classes: [],
      },
      descr: '',
      image: 'spells/',
      sources: [],
      tags: [],
    }),
  )

  const summary = await buildModule(root)
  const spells = JSON.parse(readZipEntry(summary.outputPath, 'spells.json'))

  assert.equal(spells.length, 1)
  const spell = spells[0]
  assert.deepEqual(spell.attributes, { measurement: 'imperial', ruleset: '5.5e' })
  assert.equal(spell.descr, undefined)
  assert.equal(spell.sources, undefined)
  assert.equal(spell.tags, undefined)
  assert.deepEqual(spell.data, {
    level: 0,
    ritual: false,
    activation: { time: 0 },
    range: 0,
    areaEffectSize: 0,
    duration: 0,
  })
})

test('buildModule merges an inline ```spell page block into spells.json alongside standalone files', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await mkdir(join(root, 'spells'), { recursive: true })
  await writeFile(
    join(root, 'spells', 'guidance.json'),
    JSON.stringify({
      id: 'C696B1C4-CA42-48FF-8120-2395C3DBD013',
      name: 'Guidance',
      slug: 'guidance',
      data: { level: 0, school: 'divination', rangeType: 'touch' },
    }),
  )
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '```spell',
      'name: Fireball',
      'level: 3',
      'school: evocation',
      '```',
      '',
    ].join('\n'),
  )

  const summary = await buildModule(root)

  assert.equal(summary.spellCount, 2)
  const spells = JSON.parse(readZipEntry(summary.outputPath, 'spells.json')).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  assert.equal(spells[0].name, 'Fireball')
  assert.equal(spells[0].slug, 'fireball')
  assert.match(spells[0].id, /^[0-9a-f-]{36}$/)
  assert.equal(spells[0].data.level, 3)
  assert.equal(spells[0].data.school, 'evocation')
  assert.deepEqual(spells[0].attributes, { measurement: 'imperial', ruleset: '5.5e' })
  assert.equal(spells[1].name, 'Guidance')

  // The same slug always resolves to the same id, run to run.
  const secondBuild = await buildModule(root)
  const spellsAgain = JSON.parse(readZipEntry(secondBuild.outputPath, 'spells.json')).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  assert.equal(spellsAgain[0].id, spells[0].id)
})

test('buildModule rejects an inline spell slug that collides with a standalone spell file', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await mkdir(join(root, 'spells'), { recursive: true })
  await writeFile(
    join(root, 'spells', 'fireball.json'),
    JSON.stringify({
      id: '9D36046F-200E-44A4-ADBE-64521193DAFF',
      name: 'Fireball',
      slug: 'fireball',
      data: { level: 3, school: 'evocation' },
    }),
  )
  await writeFile(
    join(root, 'pages', 'intro.md'),
    ['---', 'name: Introduction', 'slug: intro', 'rank: 0', 'parent: ""', '---', '', '```spell', 'name: Fireball', '```', ''].join(
      '\n',
    ),
  )

  await assert.rejects(buildModule(root), (error) => {
    assert.ok(error instanceof ModuleBuildError)
    assert.ok(error.issues.some((issue) => issue.message.includes('Duplicate spell slug "fireball"')))
    return true
  })
})

test('buildModule copies an inline spell\'s illustration image the same way a standalone spell does', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await mkdir(join(root, 'spells'), { recursive: true })
  await writeFile(join(root, 'spells', 'fireball.png'), 'fake-image-data')
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '```spell',
      'name: Fireball',
      'image: spells/fireball.png',
      '```',
      '',
    ].join('\n'),
  )

  const summary = await buildModule(root)

  assert.ok(listZipEntries(summary.outputPath).includes('spells/fireball.png'))
  const spells = JSON.parse(readZipEntry(summary.outputPath, 'spells.json'))
  assert.equal(spells[0].image, 'spells/fireball.png')
})

test('buildModule rejects an inline spell whose image references a missing file', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '```spell',
      'name: Fireball',
      'image: spells/missing.png',
      '```',
      '',
    ].join('\n'),
  )

  await assert.rejects(buildModule(root), (error) => {
    assert.ok(error instanceof ModuleBuildError)
    assert.ok(error.issues.some((issue) => issue.message.includes('references a missing file')))
    return true
  })
})

test('buildModule renders inline spell range/duration labels in the module\'s resolved measurement system', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '```spell',
      'name: Test Spell',
      'range: 30',
      '```',
      '',
    ].join('\n'),
  )

  const summary = await buildModule(root, { defaultMeasurement: 'metric' })
  const pages = JSON.parse(readZipEntry(summary.outputPath, 'pages.json'))

  assert.match(pages[0].content, /9 meters/)
})

test('buildModule applies a project spellDisplayDefaults to an inline spell missing the show* field', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '```spell',
      'name: Test Spell',
      'tags: [fire]',
      '```',
      '',
    ].join('\n'),
  )

  const summary = await buildModule(root, { spellDisplayDefaults: { showTags: false } })
  const pages = JSON.parse(readZipEntry(summary.outputPath, 'pages.json'))

  assert.doesNotMatch(pages[0].content, /Tags: /)
})

test('buildModule lets an inline spell\'s explicit show* field override the project spellDisplayDefaults', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '```spell',
      'name: Test Spell',
      'tags: [fire]',
      'showTags: true',
      '```',
      '',
    ].join('\n'),
  )

  const summary = await buildModule(root, { spellDisplayDefaults: { showTags: false } })
  const pages = JSON.parse(readZipEntry(summary.outputPath, 'pages.json'))

  assert.match(pages[0].content, /Tags: /)
})

test('buildModule merges an inline ```item page block into items.json alongside standalone files', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await mkdir(join(root, 'items'), { recursive: true })
  await writeFile(
    join(root, 'items', 'shield.json'),
    JSON.stringify({
      id: 'C696B1C4-CA42-48FF-8120-2395C3DBD013',
      name: 'Shield',
      slug: 'shield',
      data: { type: 'shield', value: 10 },
    }),
  )
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '```item',
      'name: Longsword',
      'type: meleeWeapon',
      'dmg1: 1d8',
      '```',
      '',
    ].join('\n'),
  )

  const summary = await buildModule(root)

  assert.equal(summary.itemCount, 2)
  const items = JSON.parse(readZipEntry(summary.outputPath, 'items.json')).sort((a, b) => a.name.localeCompare(b.name))
  assert.equal(items[0].name, 'Longsword')
  assert.equal(items[0].slug, 'longsword')
  assert.match(items[0].id, /^[0-9a-f-]{36}$/)
  assert.equal(items[0].data.type, 'meleeWeapon')
  assert.equal(items[0].data.dmg1, '1d8')
  assert.deepEqual(items[0].attributes, { measurement: 'imperial', ruleset: '5.5e' })
  assert.equal(items[1].name, 'Shield')

  const secondBuild = await buildModule(root)
  const itemsAgain = JSON.parse(readZipEntry(secondBuild.outputPath, 'items.json')).sort((a, b) => a.name.localeCompare(b.name))
  assert.equal(itemsAgain[0].id, items[0].id)
})

test('buildModule rejects an inline item slug that collides with a standalone item file', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await mkdir(join(root, 'items'), { recursive: true })
  await writeFile(
    join(root, 'items', 'longsword.json'),
    JSON.stringify({
      id: '9D36046F-200E-44A4-ADBE-64521193DAFF',
      name: 'Longsword',
      slug: 'longsword',
      data: { type: 'meleeWeapon' },
    }),
  )
  await writeFile(
    join(root, 'pages', 'intro.md'),
    ['---', 'name: Introduction', 'slug: intro', 'rank: 0', 'parent: ""', '---', '', '```item', 'name: Longsword', '```', ''].join(
      '\n',
    ),
  )

  await assert.rejects(buildModule(root), (error) => {
    assert.ok(error instanceof ModuleBuildError)
    assert.ok(error.issues.some((issue) => issue.message.includes('Duplicate item slug "longsword"')))
    return true
  })
})

test('buildModule copies an inline item\'s illustration image the same way a standalone item does', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await mkdir(join(root, 'items'), { recursive: true })
  await writeFile(join(root, 'items', 'ring.png'), 'fake-image-data')
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '```item',
      'name: Ring',
      'image: items/ring.png',
      '```',
      '',
    ].join('\n'),
  )

  const summary = await buildModule(root)

  assert.ok(listZipEntries(summary.outputPath).includes('items/ring.png'))
  const items = JSON.parse(readZipEntry(summary.outputPath, 'items.json'))
  assert.equal(items[0].image, 'items/ring.png')
})

test('buildModule rejects an inline item whose image references a missing file', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '```item',
      'name: Ring',
      'image: items/missing.png',
      '```',
      '',
    ].join('\n'),
  )

  await assert.rejects(buildModule(root), (error) => {
    assert.ok(error instanceof ModuleBuildError)
    assert.ok(error.issues.some((issue) => issue.message.includes('references a missing file')))
    return true
  })
})

test('buildModule renders an inline item\'s weight in the module\'s resolved measurement unit, with no conversion', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    ['---', 'name: Introduction', 'slug: intro', 'rank: 0', 'parent: ""', '---', '', '```item', 'name: Test Item', 'weight: 12', '```', ''].join(
      '\n',
    ),
  )

  const summary = await buildModule(root, { defaultMeasurement: 'metric' })
  const pages = JSON.parse(readZipEntry(summary.outputPath, 'pages.json'))

  assert.match(pages[0].content, /12 kg/)
})

test('buildModule applies a project itemDisplayDefaults to an inline item missing the show* field', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    ['---', 'name: Introduction', 'slug: intro', 'rank: 0', 'parent: ""', '---', '', '```item', 'name: Test Item', 'tags: [treasure]', '```', ''].join(
      '\n',
    ),
  )

  const summary = await buildModule(root, { itemDisplayDefaults: { showTags: false } })
  const pages = JSON.parse(readZipEntry(summary.outputPath, 'pages.json'))

  assert.doesNotMatch(pages[0].content, /Tags: /)
})

test('buildModule lets an inline item\'s explicit show* field override the project itemDisplayDefaults', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '```item',
      'name: Test Item',
      'tags: [treasure]',
      'showTags: true',
      '```',
      '',
    ].join('\n'),
  )

  const summary = await buildModule(root, { itemDisplayDefaults: { showTags: false } })
  const pages = JSON.parse(readZipEntry(summary.outputPath, 'pages.json'))

  assert.match(pages[0].content, /Tags: /)
})

test('buildModule merges an inline ```monster page block into monsters.json alongside standalone files', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await mkdir(join(root, 'monsters'), { recursive: true })
  await writeFile(
    join(root, 'monsters', 'goblin.json'),
    JSON.stringify({
      id: 'C696B1C4-CA42-48FF-8120-2395C3DBD013',
      name: 'Goblin',
      slug: 'goblin',
      data: { type: 'humanoid', cr: '1/4' },
    }),
  )
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '```monster',
      'name: Owlbear',
      'type: monstrosity',
      'cr: "3"',
      '```',
      '',
    ].join('\n'),
  )

  const summary = await buildModule(root)

  assert.equal(summary.monsterCount, 2)
  const monsters = JSON.parse(readZipEntry(summary.outputPath, 'monsters.json')).sort((a, b) => a.name.localeCompare(b.name))
  assert.equal(monsters[0].name, 'Goblin')
  assert.equal(monsters[1].name, 'Owlbear')
  assert.equal(monsters[1].slug, 'owlbear')
  assert.match(monsters[1].id, /^[0-9a-f-]{36}$/)
  assert.equal(monsters[1].data.type, 'monstrosity')
  assert.equal(monsters[1].data.cr, '3')
  assert.deepEqual(monsters[1].attributes, { measurement: 'imperial', ruleset: '5.5e' })

  const secondBuild = await buildModule(root)
  const monstersAgain = JSON.parse(readZipEntry(secondBuild.outputPath, 'monsters.json')).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  assert.equal(monstersAgain[1].id, monsters[1].id)
})

test('buildModule rejects an inline monster slug that collides with a standalone monster file', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await mkdir(join(root, 'monsters'), { recursive: true })
  await writeFile(
    join(root, 'monsters', 'owlbear.json'),
    JSON.stringify({
      id: '9D36046F-200E-44A4-ADBE-64521193DAFF',
      name: 'Owlbear',
      slug: 'owlbear',
      data: { type: 'monstrosity' },
    }),
  )
  await writeFile(
    join(root, 'pages', 'intro.md'),
    ['---', 'name: Introduction', 'slug: intro', 'rank: 0', 'parent: ""', '---', '', '```monster', 'name: Owlbear', '```', ''].join(
      '\n',
    ),
  )

  await assert.rejects(buildModule(root), (error) => {
    assert.ok(error instanceof ModuleBuildError)
    assert.ok(error.issues.some((issue) => issue.message.includes('Duplicate monster slug "owlbear"')))
    return true
  })
})

test('buildModule copies both an inline monster\'s image and token the same way a standalone monster does', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await mkdir(join(root, 'monsters'), { recursive: true })
  await writeFile(join(root, 'monsters', 'dragon.png'), 'fake-image-data')
  await writeFile(join(root, 'monsters', 'dragon-token.png'), 'fake-token-data')
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '```monster',
      'name: Dragon',
      'image: monsters/dragon.png',
      'token: monsters/dragon-token.png',
      '```',
      '',
    ].join('\n'),
  )

  const summary = await buildModule(root)

  assert.ok(listZipEntries(summary.outputPath).includes('monsters/dragon.png'))
  assert.ok(listZipEntries(summary.outputPath).includes('monsters/dragon-token.png'))
  const monsters = JSON.parse(readZipEntry(summary.outputPath, 'monsters.json'))
  assert.equal(monsters[0].image, 'monsters/dragon.png')
  assert.equal(monsters[0].token, 'monsters/dragon-token.png')
})

test('buildModule rejects an inline monster whose token references a missing file', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '```monster',
      'name: Dragon',
      'token: monsters/missing.png',
      '```',
      '',
    ].join('\n'),
  )

  await assert.rejects(buildModule(root), (error) => {
    assert.ok(error instanceof ModuleBuildError)
    assert.ok(error.issues.some((issue) => issue.message.includes('references a missing file')))
    return true
  })
})

test('buildModule never puts a {.class} fence annotation into the built monsters.json (presentation-only, not a YAML field)', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    ['---', 'name: Introduction', 'slug: intro', 'rank: 0', 'parent: ""', '---', '', '```monster {.red .two-column}', 'name: Dragon', '```', ''].join(
      '\n',
    ),
  )

  const summary = await buildModule(root)
  const monsters = JSON.parse(readZipEntry(summary.outputPath, 'monsters.json'))
  const pages = JSON.parse(readZipEntry(summary.outputPath, 'pages.json'))

  assert.equal(monsters[0].color, undefined)
  assert.equal(monsters[0].twoColumn, undefined)
  // The built page HTML still reflects the color/two-column class, though —
  // that's a real rendering concern, just never merged into monsters.json.
  assert.match(pages[0].content, /<div class="statblock red two-column">/)
})

test('buildModule applies a project monsterDisplayDefaults to an inline monster missing the show* field', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '```monster',
      'name: Test Monster',
      'tags: [dragon]',
      '```',
      '',
    ].join('\n'),
  )

  const summary = await buildModule(root, { monsterDisplayDefaults: { showTags: false } })
  const pages = JSON.parse(readZipEntry(summary.outputPath, 'pages.json'))

  assert.doesNotMatch(pages[0].content, /Tags: /)
})

test('buildModule lets an inline monster\'s explicit show* field override the project monsterDisplayDefaults', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '```monster',
      'name: Test Monster',
      'tags: [dragon]',
      'showTags: true',
      '```',
      '',
    ].join('\n'),
  )

  const summary = await buildModule(root, { monsterDisplayDefaults: { showTags: false } })
  const pages = JSON.parse(readZipEntry(summary.outputPath, 'pages.json'))

  assert.match(pages[0].content, /Tags: /)
})

test('buildModule omits tables.json when there are no roll tables', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)

  const summary = await buildModule(root)

  assert.equal(summary.tableCount, 0)
  assert.ok(!listZipEntries(summary.outputPath).includes('tables.json'))
})

test('buildModule writes tables.json, drops "rolls", and strips a default rollMode', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'tables'), { recursive: true })
  await writeFile(
    join(root, 'tables', 'loot.json'),
    JSON.stringify({
      id: '2FC0C658-407E-4385-85B2-454702C98BA2',
      name: 'Test de table V5',
      slug: 'test-de-table-v5',
      columns: [{ name: 'D4' }, { name: 'Objet' }],
      rows: [
        ['1', 'Blue'],
        ['2', 'Red'],
      ],
      rollMode: 'normal',
      rolls: [],
      descr: 'La description de la table',
      sources: [{ name: 'Source', page: 12 }],
      tags: ['tag'],
    }),
  )
  await writeFile(
    join(root, 'tables', 'no-repeat.json'),
    JSON.stringify({
      id: '593D0D31-F4CA-4F5B-AC90-7990E0B30A88',
      name: 'Table 2 Copy',
      slug: 'table-2-copy',
      columns: [{ name: 'D2' }, { name: 'Rang' }],
      rows: [
        ['1', '1'],
        ['2', '2'],
      ],
      rollMode: 'noRepeat',
      rolls: [],
    }),
  )

  const summary = await buildModule(root)

  assert.equal(summary.tableCount, 2)
  const tables = JSON.parse(readZipEntry(summary.outputPath, 'tables.json')).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  assert.equal(tables[0].name, 'Table 2 Copy')
  assert.equal(tables[0].rollMode, 'noRepeat')
  assert.equal(tables[0].rolls, undefined)
  assert.equal(tables[0].sources, undefined)
  assert.equal(tables[1].name, 'Test de table V5')
  assert.equal(tables[1].rollMode, undefined)
  assert.equal(tables[1].rolls, undefined)
  assert.deepEqual(tables[1].sources, [{ name: 'Source', page: 12 }])
})

test('buildModule rejects a roll table with fewer than two columns', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'tables'), { recursive: true })
  await writeFile(
    join(root, 'tables', 'bad.json'),
    JSON.stringify({
      id: '2FC0C658-407E-4385-85B2-454702C98BA2',
      name: 'Bad',
      slug: 'bad',
      columns: [{ name: 'D4' }],
      rows: [['1']],
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.ok(error.issues.some((issue) => issue.message.includes('at least two entries')))
      return true
    },
  )
})

test('buildModule rejects a roll table row with the wrong number of cells', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'tables'), { recursive: true })
  await writeFile(
    join(root, 'tables', 'bad.json'),
    JSON.stringify({
      id: '2FC0C658-407E-4385-85B2-454702C98BA2',
      name: 'Bad',
      slug: 'bad',
      columns: [{ name: 'D4' }, { name: 'Result' }],
      rows: [['1', 'Blue', 'extra']],
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.ok(error.issues.some((issue) => issue.message.includes('matching the number of columns')))
      return true
    },
  )
})

test('buildModule rejects an invalid roll table rollMode', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'tables'), { recursive: true })
  await writeFile(
    join(root, 'tables', 'bad.json'),
    JSON.stringify({
      id: '2FC0C658-407E-4385-85B2-454702C98BA2',
      name: 'Bad',
      slug: 'bad',
      columns: [{ name: 'D4' }, { name: 'Result' }],
      rows: [['1', 'Blue']],
      rollMode: 'sometimes',
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.ok(error.issues.some((issue) => issue.message.includes('rollMode must be one of')))
      return true
    },
  )
})

test('buildModule rejects duplicate roll table ids and slugs', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'tables'), { recursive: true })
  await writeFile(
    join(root, 'tables', 'a.json'),
    JSON.stringify({
      id: '2FC0C658-407E-4385-85B2-454702C98BA2',
      name: 'A',
      slug: 'dup-table',
      columns: [{ name: 'D4' }, { name: 'Result' }],
      rows: [['1', 'Blue']],
    }),
  )
  await writeFile(
    join(root, 'tables', 'b.json'),
    JSON.stringify({
      id: '2FC0C658-407E-4385-85B2-454702C98BA2',
      name: 'B',
      slug: 'dup-table',
      columns: [{ name: 'D4' }, { name: 'Result' }],
      rows: [['1', 'Red']],
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.ok(error.issues.some((issue) => issue.message.includes('Duplicate roll table id')))
      assert.ok(error.issues.some((issue) => issue.message.includes('Duplicate roll table slug')))
      return true
    },
  )
})

test('buildModule merges a roll table auto-detected from a page\'s Markdown table into tables.json', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '## Encounter Table {.table-title}',
      '',
      '|[2d6](/roll/2d6){.no-repeat}|Encounter|',
      '|:---:|:---|',
      '|2-3|3 Kobolds|',
      '|4-5|2 Owlbears|',
      '',
    ].join('\n'),
  )

  const summary = await buildModule(root)

  assert.equal(summary.tableCount, 1)
  const tables = JSON.parse(readZipEntry(summary.outputPath, 'tables.json'))
  assert.equal(tables[0].name, 'Encounter Table')
  assert.equal(tables[0].slug, 'intro-encounter-table')
  assert.match(tables[0].id, /^[0-9a-f-]{36}$/)
  assert.equal(tables[0].rollMode, 'noRepeat')
  assert.deepEqual(tables[0].columns, [{ name: '2d6' }, { name: 'Encounter' }])
  assert.deepEqual(tables[0].rows, [
    ['2-3', '3 Kobolds'],
    ['4-5', '2 Owlbears'],
  ])

  // The same slug always resolves to the same id, run to run.
  const secondBuild = await buildModule(root)
  const tablesAgain = JSON.parse(readZipEntry(secondBuild.outputPath, 'tables.json'))
  assert.equal(tablesAgain[0].id, tables[0].id)
})

test('buildModule merges an inline roll table alongside a standalone one in the same build', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await mkdir(join(root, 'tables'), { recursive: true })
  await writeFile(
    join(root, 'tables', 'loot.json'),
    JSON.stringify({
      id: '2FC0C658-407E-4385-85B2-454702C98BA2',
      name: 'Loot',
      slug: 'loot',
      columns: [{ name: 'D4' }, { name: 'Item' }],
      rows: [['1', 'Sword']],
    }),
  )
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '|[2d6](/roll/2d6)|Encounter|',
      '|:---:|:---|',
      '|2-3|3 Kobolds|',
      '',
    ].join('\n'),
  )

  const summary = await buildModule(root)

  assert.equal(summary.tableCount, 2)
  const tables = JSON.parse(readZipEntry(summary.outputPath, 'tables.json')).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  assert.deepEqual(
    tables.map((table) => table.name),
    ['Introduction — Encounter', 'Loot'],
  )
})

test('buildModule rejects an inline roll table slug that collides with a standalone table file', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await mkdir(join(root, 'tables'), { recursive: true })
  await writeFile(
    join(root, 'tables', 'encounter.json'),
    JSON.stringify({
      id: '2FC0C658-407E-4385-85B2-454702C98BA2',
      name: 'Introduction — Encounter',
      slug: 'intro-encounter',
      columns: [{ name: 'D4' }, { name: 'Item' }],
      rows: [['1', 'Sword']],
    }),
  )
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '## Encounter {.table-title}',
      '',
      '|[2d6](/roll/2d6)|Encounter|',
      '|:---:|:---|',
      '|2-3|3 Kobolds|',
      '',
    ].join('\n'),
  )

  await assert.rejects(buildModule(root), (error) => {
    assert.ok(error instanceof ModuleBuildError)
    assert.ok(error.issues.some((issue) => issue.message.includes('Duplicate roll table slug "intro-encounter"')))
    return true
  })
})

test('buildModule({ autoDetectRollTables: false }) never merges a table auto-detected from a page', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '|[2d6](/roll/2d6)|Encounter|',
      '|:---:|:---|',
      '|2-3|3 Kobolds|',
      '',
    ].join('\n'),
  )

  const summary = await buildModule(root, { autoDetectRollTables: false })

  assert.equal(summary.tableCount, 0)
  assert.ok(!listZipEntries(summary.outputPath).includes('tables.json'))
})

test('buildModule omits monsters.json when there are no monsters', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)

  const summary = await buildModule(root)

  assert.equal(summary.monsterCount, 0)
  assert.ok(!listZipEntries(summary.outputPath).includes('monsters.json'))
})

test('buildModule writes monsters.json and copies both image and token', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'monsters'), { recursive: true })
  await writeFile(join(root, 'monsters', 'illustration.png'), 'fake-image-bytes')
  await writeFile(join(root, 'monsters', 'token.png'), 'fake-token-bytes')
  await writeFile(
    join(root, 'monsters', 'elemental.json'),
    JSON.stringify({
      id: '2C8AB919-3EDA-442A-9546-C23BDC624660',
      name: 'Nom du montre',
      slug: 'nom-du-montre',
      attributes: { measurement: 'metric', ruleset: '5.5e' },
      data: {
        size: 'M',
        type: 'elemental',
        alignment: 'CG',
        ac: '12',
        hp: '16 (1d8+34)',
        speed: { burrow: 12, walk: 9 },
        abilities: { str: 12, dex: 14, con: 18, int: 15, wis: 10, cha: 9 },
        savingThrows: { str: 2, int: 3 },
        skills: { animalHandling: 12, insight: 2, medicine: 5 },
        conditionImmunities: ['Aveuglé', 'Effrayé'],
        damageImmunities: ['force', 'radiant'],
        damageResistances: ['lightning', 'radiant'],
        damageVulnerabilities: ['cold', 'radiant'],
        senses: { tremorsense: 12 },
        passivePerception: 14,
        languages: ['common', 'elvish'],
        cr: '1/4',
        initiativeBonus: 2,
        proficiencyBonus: 2,
        environments: ['forest', 'coastal'],
        traits: [{ name: 'Trait 1', text: 'La description du trait.', usage: '2/jour' }],
        actions: [
          { name: 'Action 1', text: "La description de l'action.", usage: 'Champ' },
          { name: 'Action 2', text: 'La description.' },
        ],
        bonusActions: [{ name: 'Action bonus 1', text: 'La description.' }],
        reactions: [{ name: 'Réaction 1', text: 'La description.' }],
        legendaryActions: [{ name: 'Action légendaire', text: 'la description' }],
      },
      descr: 'La description du monstre',
      image: 'monsters/illustration.png',
      token: 'monsters/token.png',
      sources: [{ name: 'Source', page: 12 }],
    }),
  )

  const summary = await buildModule(root)

  assert.equal(summary.monsterCount, 1)
  const monsters = JSON.parse(readZipEntry(summary.outputPath, 'monsters.json'))
  assert.equal(monsters.length, 1)
  assert.equal(monsters[0].name, 'Nom du montre')
  assert.equal(monsters[0].data.type, 'elemental')
  assert.deepEqual(monsters[0].data.speed, { burrow: 12, walk: 9 })
  assert.deepEqual(monsters[0].data.savingThrows, { str: 2, int: 3 })
  const zipEntries = listZipEntries(summary.outputPath)
  assert.ok(zipEntries.includes('monsters/illustration.png'))
  assert.ok(zipEntries.includes('monsters/token.png'))
})

test('buildModule rejects a monster with an unrecognized data.type', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'monsters'), { recursive: true })
  await writeFile(
    join(root, 'monsters', 'bad.json'),
    JSON.stringify({
      id: '2C8AB919-3EDA-442A-9546-C23BDC624660',
      name: 'Bad',
      slug: 'bad',
      data: { type: 'notAType' },
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.ok(error.issues.some((issue) => issue.message.includes('not a recognized monster type')))
      return true
    },
  )
})

test('buildModule rejects a monster with an unrecognized challenge rating', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'monsters'), { recursive: true })
  await writeFile(
    join(root, 'monsters', 'bad.json'),
    JSON.stringify({
      id: '2C8AB919-3EDA-442A-9546-C23BDC624660',
      name: 'Bad',
      slug: 'bad',
      data: { cr: '1/3' },
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.ok(error.issues.some((issue) => issue.message.includes('not a recognized challenge rating')))
      return true
    },
  )
})

test('buildModule accepts a custom monster language and environment alongside the standard list', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'monsters'), { recursive: true })
  await writeFile(
    join(root, 'monsters', 'custom.json'),
    JSON.stringify({
      id: '2C8AB919-3EDA-442A-9546-C23BDC624660',
      name: 'Custom',
      slug: 'custom',
      data: {
        languages: ['common', 'Thieves’ Cant'],
        environments: ['forest', 'The Feywild'],
        cr: '1/8',
      },
    }),
  )

  const summary = await buildModule(root)
  const monsters = JSON.parse(readZipEntry(summary.outputPath, 'monsters.json'))
  assert.deepEqual(monsters[0].data.languages, ['common', 'Thieves’ Cant'])
  assert.deepEqual(monsters[0].data.environments, ['forest', 'The Feywild'])
  assert.equal(monsters[0].data.cr, '1/8')
})

test('buildModule rejects a monster with an unrecognized savingThrows key', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'monsters'), { recursive: true })
  await writeFile(
    join(root, 'monsters', 'bad.json'),
    JSON.stringify({
      id: '2C8AB919-3EDA-442A-9546-C23BDC624660',
      name: 'Bad',
      slug: 'bad',
      data: { savingThrows: { strength: 2 } },
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.ok(error.issues.some((issue) => issue.message.includes('not a recognized ability')))
      return true
    },
  )
})

test('buildModule rejects a monster feature entry with a non-string text', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'monsters'), { recursive: true })
  await writeFile(
    join(root, 'monsters', 'bad.json'),
    JSON.stringify({
      id: '2C8AB919-3EDA-442A-9546-C23BDC624660',
      name: 'Bad',
      slug: 'bad',
      data: { actions: [{ name: 'Bite', text: 42 }] },
    }),
  )

  await assert.rejects(
    () => buildModule(root),
    (error) => {
      assert.ok(error instanceof ModuleBuildError)
      assert.ok(error.issues.some((issue) => issue.message.includes("data.actions entries' text must be a string")))
      return true
    },
  )
})

test('buildModule strips empty optional monster fields and drops empty savingThrows/skills', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'monsters'), { recursive: true })
  await writeFile(
    join(root, 'monsters', 'exhaustive.json'),
    JSON.stringify({
      id: '2C8AB919-3EDA-442A-9546-C23BDC624660',
      name: 'Exhaustive Monster',
      slug: 'exhaustive-monster',
      attributes: { measurement: '', ruleset: '' },
      data: {
        size: '',
        type: '',
        typeDetail: '',
        alignment: '',
        ac: '',
        hp: '',
        speed: { walk: 0, burrow: 0, climb: 0, fly: 0, hover: false, swim: 0, other: '' },
        abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        savingThrows: {},
        skills: {},
        conditionImmunities: [],
        damageImmunities: [],
        damageResistances: [],
        damageVulnerabilities: [],
        senses: { blindsight: 0, darkvision: 0, tremorsense: 0, truesight: 0, other: '' },
        passivePerception: 0,
        languages: [],
        cr: '',
        initiativeBonus: 0,
        proficiencyBonus: 0,
        environments: [],
        traits: [],
        actions: [],
        bonusActions: [],
        reactions: [],
        legendaryActions: [],
      },
      descr: '',
      image: 'monsters/',
      token: 'monsters/',
      sources: [],
      tags: [],
    }),
  )

  const summary = await buildModule(root)
  const monsters = JSON.parse(readZipEntry(summary.outputPath, 'monsters.json'))

  assert.equal(monsters.length, 1)
  const monster = monsters[0]
  assert.deepEqual(monster.attributes, { measurement: 'imperial', ruleset: '5.5e' })
  assert.equal(monster.descr, undefined)
  assert.equal(monster.sources, undefined)
  assert.equal(monster.tags, undefined)
  assert.deepEqual(monster.data, {
    speed: { walk: 0, burrow: 0, climb: 0, fly: 0, hover: false, swim: 0 },
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    senses: { blindsight: 0, darkvision: 0, tremorsense: 0, truesight: 0 },
    passivePerception: 0,
    initiativeBonus: 0,
    proficiencyBonus: 0,
  })
})

test('buildModule fills empty attributes.measurement/ruleset from defaultMeasurement but keeps an explicit value', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'items'), { recursive: true })
  await writeFile(
    join(root, 'items', 'unset.json'),
    JSON.stringify({ id: '9D36046F-200E-44A4-ADBE-64521193DAFF', name: 'Unset', slug: 'unset' }),
  )
  await writeFile(
    join(root, 'items', 'explicit.json'),
    JSON.stringify({
      id: 'C607D322-AA92-43E9-A022-1120A9891E11',
      name: 'Explicit',
      slug: 'explicit',
      attributes: { measurement: 'imperial', ruleset: '5e' },
    }),
  )

  const summary = await buildModule(root, { defaultMeasurement: 'metric' })
  const items = JSON.parse(readZipEntry(summary.outputPath, 'items.json')).sort((a, b) => a.name.localeCompare(b.name))

  assert.deepEqual(items[0].attributes, { measurement: 'imperial', ruleset: '5e' })
  assert.deepEqual(items[1].attributes, { measurement: 'metric', ruleset: '5.5e' })
})

test('buildModule defaults to imperial when no defaultMeasurement option is passed', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'items'), { recursive: true })
  await writeFile(
    join(root, 'items', 'unset.json'),
    JSON.stringify({ id: '9D36046F-200E-44A4-ADBE-64521193DAFF', name: 'Unset', slug: 'unset' }),
  )

  const summary = await buildModule(root)
  const items = JSON.parse(readZipEntry(summary.outputPath, 'items.json'))

  assert.deepEqual(items[0].attributes, { measurement: 'imperial', ruleset: '5.5e' })
})

test('buildModule flags a same-module page link that doesn\'t match any real slug, as a non-blocking warning', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    ['---', 'name: Introduction', 'slug: intro', 'rank: 0', 'parent: ""', '---', '', '[Broken](typo-slug)', ''].join('\n'),
  )

  const summary = await buildModule(root)

  assert.equal(summary.pageCount, 1)
  assert.equal(summary.brokenLinks.length, 1)
  assert.equal(summary.brokenLinks[0].file, 'pages/intro.md')
  assert.match(summary.brokenLinks[0].message, /"typo-slug"/)
})

test('buildModule does not flag a same-module page link that matches a real page/group/map/encounter slug', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '[Good](chapter-two)',
      '',
    ].join('\n'),
  )
  await writeFile(
    join(root, 'pages', 'chapter-two.md'),
    ['---', 'name: Chapter Two', 'slug: chapter-two', 'rank: 1', 'parent: ""', '---', '', 'Content.', ''].join('\n'),
  )

  const summary = await buildModule(root)

  assert.equal(summary.brokenLinks.length, 0)
})

test('buildModule flags a #anchor link with no matching heading on the same page', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '# Real Heading',
      '',
      '[Broken anchor](#nope)',
      '',
    ].join('\n'),
  )

  const summary = await buildModule(root)

  assert.equal(summary.brokenLinks.length, 1)
  assert.match(summary.brokenLinks[0].message, /"#nope"/)
  assert.match(summary.brokenLinks[0].message, /heading/)
})

test('buildModule does not flag a #anchor link that matches a real heading on the same page', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '# Real Heading',
      '',
      '[Good anchor](#real-heading)',
      '',
    ].join('\n'),
  )

  const summary = await buildModule(root)

  assert.equal(summary.brokenLinks.length, 0)
})

test('buildModule never flags external URLs, compendium links, or cross-module page links', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    [
      '---',
      'name: Introduction',
      'slug: intro',
      'rank: 0',
      'parent: ""',
      '---',
      '',
      '[External](https://example.com)',
      '',
      '[Item](/item/some-item)',
      '',
      '[Spell](/spell/some-spell)',
      '',
      '[Monster](/monster/some-monster)',
      '',
      '[Roll](/roll/2d6)',
      '',
      '[Long-form page](/page/some-page)',
      '',
      '[Cross-module](/module/other-module/page/some-page)',
      '',
      '[Email](mailto:test@example.com)',
      '',
    ].join('\n'),
  )

  const summary = await buildModule(root)

  assert.equal(summary.brokenLinks.length, 0)
})

test('buildModule flagging a broken link does not fail the build (non-blocking)', async () => {
  const root = await makeTempModule()
  await writeValidModule(root)
  await mkdir(join(root, 'pages'), { recursive: true })
  await writeFile(
    join(root, 'pages', 'intro.md'),
    ['---', 'name: Introduction', 'slug: intro', 'rank: 0', 'parent: ""', '---', '', '[Broken](typo-slug)', ''].join('\n'),
  )

  // Would throw ModuleBuildError if this were treated as a hard failure.
  const summary = await buildModule(root)
  assert.ok(summary.outputPath)
})
