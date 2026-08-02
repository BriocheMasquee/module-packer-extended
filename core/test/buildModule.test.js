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
