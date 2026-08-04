const assert = require('node:assert/strict')
const { mkdir, mkdtemp, readdir, readFile, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const { discoverProjectThemes, resolveProjectTheme, projectAssetsMatchTheme, replaceProjectThemeAssets } = require('../dist/index.js')

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), 'mpx-core-theme-test-'))
}

async function makeThemesRoot(themes) {
  const root = await makeTempDir()
  for (const theme of themes) {
    const themeDirectory = join(root, theme.id)
    await mkdir(join(themeDirectory, 'css'), { recursive: true })
    await writeFile(join(themeDirectory, 'theme.json'), JSON.stringify({ id: theme.id, name: theme.name, description: theme.description }))
    await writeFile(join(themeDirectory, 'css', 'global.css'), theme.css ?? 'body {}')
    if (theme.withCustomCss) {
      await writeFile(join(themeDirectory, 'css', 'custom.css'), theme.withCustomCss)
    }
  }
  return root
}

test('discoverProjectThemes finds every theme.json under the themes directory', async () => {
  const root = await makeThemesRoot([
    { id: '5.5e', name: '5.5e', description: 'Modern.' },
    { id: 'legacy', name: 'Legacy', description: 'Classic.' },
  ])

  const themes = await discoverProjectThemes(root)

  assert.deepEqual(
    themes.map((theme) => theme.id).sort(),
    ['5.5e', 'legacy'],
  )
  assert.equal(themes.find((theme) => theme.id === '5.5e').name, '5.5e')
})

test('discoverProjectThemes skips a theme.json whose id does not match its folder name', async () => {
  const root = await makeTempDir()
  await mkdir(join(root, 'mismatched'), { recursive: true })
  await writeFile(join(root, 'mismatched', 'theme.json'), JSON.stringify({ id: 'other-id', name: 'X', description: 'Y' }))

  const themes = await discoverProjectThemes(root)

  assert.deepEqual(themes, [])
})

test('discoverProjectThemes skips a folder with no theme.json at all', async () => {
  const root = await makeTempDir()
  await mkdir(join(root, 'not-a-theme'), { recursive: true })

  const themes = await discoverProjectThemes(root)

  assert.deepEqual(themes, [])
})

test('discoverProjectThemes returns an empty array when the themes directory does not exist', async () => {
  const themes = await discoverProjectThemes(join(await makeTempDir(), 'does-not-exist'))
  assert.deepEqual(themes, [])
})

test('resolveProjectTheme finds a theme by id, or returns undefined', async () => {
  const root = await makeThemesRoot([{ id: '5.5e', name: '5.5e', description: 'Modern.' }])
  const themes = await discoverProjectThemes(root)

  assert.equal(resolveProjectTheme(themes, '5.5e').name, '5.5e')
  assert.equal(resolveProjectTheme(themes, 'nope'), undefined)
})

test('projectAssetsMatchTheme is true right after a fresh copy, false once the theme changes', async () => {
  const root = await makeThemesRoot([{ id: '5.5e', name: '5.5e', description: 'Modern.' }])
  const [theme] = await discoverProjectThemes(root)
  const project = await makeTempDir()

  await mkdir(join(project, 'assets', 'css'), { recursive: true })
  await writeFile(join(project, 'assets', 'css', 'global.css'), 'body {}')

  assert.equal(await projectAssetsMatchTheme(project, theme), true)

  await writeFile(join(theme.themeDirectory, 'css', 'global.css'), 'body { color: red; }')
  assert.equal(await projectAssetsMatchTheme(project, theme), false)
})

test('projectAssetsMatchTheme ignores custom.css/custom.js entirely', async () => {
  const root = await makeThemesRoot([{ id: '5.5e', name: '5.5e', description: 'Modern.', withCustomCss: '/* template */' }])
  const [theme] = await discoverProjectThemes(root)
  const project = await makeTempDir()

  await mkdir(join(project, 'assets', 'css'), { recursive: true })
  await writeFile(join(project, 'assets', 'css', 'global.css'), 'body {}')
  await writeFile(join(project, 'assets', 'css', 'custom.css'), '/* my own edits, totally different */')

  assert.equal(await projectAssetsMatchTheme(project, theme), true)
})

test('replaceProjectThemeAssets copies every managed theme file into a fresh project', async () => {
  const root = await makeThemesRoot([{ id: '5.5e', name: '5.5e', description: 'Modern.' }])
  const [theme] = await discoverProjectThemes(root)
  const project = await makeTempDir()

  await replaceProjectThemeAssets(project, theme)

  const content = await readFile(join(project, 'assets', 'css', 'global.css'), 'utf8')
  assert.equal(content, 'body {}')
  assert.ok(!(await readdir(join(project, 'assets'))).includes('theme.json'))
})

test('replaceProjectThemeAssets overwrites a stale managed file (the issue #27 fix)', async () => {
  const root = await makeThemesRoot([{ id: '5.5e', name: '5.5e', description: 'Modern.' }])
  const [theme] = await discoverProjectThemes(root)
  const project = await makeTempDir()

  await mkdir(join(project, 'assets', 'css'), { recursive: true })
  await writeFile(join(project, 'assets', 'css', 'global.css'), 'stale content from an older extension version')

  await replaceProjectThemeAssets(project, theme)

  const content = await readFile(join(project, 'assets', 'css', 'global.css'), 'utf8')
  assert.equal(content, 'body {}')
})

test('replaceProjectThemeAssets never overwrites an existing custom.css', async () => {
  const root = await makeThemesRoot([{ id: '5.5e', name: '5.5e', description: 'Modern.', withCustomCss: '/* template */' }])
  const [theme] = await discoverProjectThemes(root)
  const project = await makeTempDir()

  await mkdir(join(project, 'assets', 'css'), { recursive: true })
  await writeFile(join(project, 'assets', 'css', 'custom.css'), '.my-rule { color: gold; }')

  await replaceProjectThemeAssets(project, theme)

  const content = await readFile(join(project, 'assets', 'css', 'custom.css'), 'utf8')
  assert.equal(content, '.my-rule { color: gold; }')
})

test('replaceProjectThemeAssets seeds custom.css from the theme template when the project has none yet', async () => {
  const root = await makeThemesRoot([{ id: '5.5e', name: '5.5e', description: 'Modern.', withCustomCss: '/* template */' }])
  const [theme] = await discoverProjectThemes(root)
  const project = await makeTempDir()

  await replaceProjectThemeAssets(project, theme)

  const content = await readFile(join(project, 'assets', 'css', 'custom.css'), 'utf8')
  assert.equal(content, '/* template */')
})
