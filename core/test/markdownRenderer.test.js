const assert = require('node:assert/strict')
const test = require('node:test')

const { createMarkdownRenderer } = require('../dist/index.js')

test('createMarkdownRenderer wraps a plain blockquote in the generic wrap div', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('> Some quote\n')
  assert.match(html, /<div class="blockquote-wrap"><blockquote>/)
  assert.match(html, /<\/blockquote>\s*<\/div>/)
})

test('createMarkdownRenderer wraps a "paper" blockquote in its dedicated wrap div', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('> Some quote\n{.paper}\n')
  assert.match(html, /<div class="blockquote-paper-wrap">/)
})

test('createMarkdownRenderer does not wrap a "flowchart" blockquote at all', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('> Chapter 1\n{.flowchart}\n')
  assert.doesNotMatch(html, /<div class="blockquote/)
  assert.match(html, /<blockquote class="flowchart">/)
})

test('createMarkdownRenderer does not mix up wrap classes across consecutive blockquotes', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('> Chapter 1\n{.flowchart}\n\n> A quote\n{.paper}\n\n> Chapter 2\n{.flowchart}\n')
  assert.doesNotMatch(html, /<div class="blockquote-wrap"><blockquote class="flowchart">/)
  assert.match(html, /<div class="blockquote-paper-wrap"><blockquote class="paper">/)
  assert.equal((html.match(/<div class="blockquote/g) ?? []).length, 1)
  assert.equal((html.match(/<\/div>/g) ?? []).length, 1)
})

test('createMarkdownRenderer wraps a "flavortext" blockquote in its dedicated wrap div', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('> Some quote\n{.flavortext}\n')
  assert.match(html, /<div class="blockquote-flavortext-wrap">/)
})

test('createMarkdownRenderer does not hide front matter or wrap #page by default (build mode)', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('---\nname: Test\nslug: test\n---\n\n# Hello\n')
  assert.match(html, /name: Test/)
  assert.doesNotMatch(html, /<div id="page">/)
})

test('createMarkdownRenderer({ preview: true }) hides front matter', () => {
  const markdown = createMarkdownRenderer({ preview: true })
  const html = markdown.render('---\nname: Test\nslug: test\n---\n\n# Hello\n')
  assert.doesNotMatch(html, /name: Test/)
  assert.match(html, /<h1[^>]*>Hello<\/h1>/)
})

test('createMarkdownRenderer({ preview: true }) wraps block content in #page', () => {
  const markdown = createMarkdownRenderer({ preview: true })
  const html = markdown.render('# Hello\n')
  assert.match(html, /^<div id="page">[\s\S]*<\/div>$/)
})

test('createMarkdownRenderer({ preview: true }) does not wrap inline-only content in #page', () => {
  const markdown = createMarkdownRenderer({ preview: true })
  const html = markdown.renderInline('just *inline* text')
  assert.doesNotMatch(html, /<div id="page">/)
})

test('createMarkdownRenderer({ preview: true }) rewrites absolute and relative images/ paths', () => {
  const markdown = createMarkdownRenderer({ preview: true })
  const htmlAbsolute = markdown.render('![alt](/images/cover.png)\n')
  const htmlRelative = markdown.render('![alt](images/cover.png)\n')
  assert.match(htmlAbsolute, /src="\.\.\/images\/cover\.png"/)
  assert.match(htmlRelative, /src="\.\.\/images\/cover\.png"/)
})

test('createMarkdownRenderer (build mode) leaves images/ paths untouched', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('![alt](images/cover.png)\n')
  assert.match(html, /src="images\/cover\.png"/)
})

test('createMarkdownRenderer (build mode) strips a leading slash from /images/ paths', () => {
  // EncounterPlus fails to load a leading "/images/..." path in the built
  // module — confirmed by a real import test — even though it's a harmless
  // way to write the path in the source Markdown.
  const markdown = createMarkdownRenderer()
  const html = markdown.render('![alt](/images/cover.png)\n')
  assert.match(html, /src="images\/cover\.png"/)
})

test('createMarkdownRenderer wraps a "caption" image in figure/figcaption and drops the marker class', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('![My Image Description](images/banner.png){.caption}\n')
  assert.match(html, /<figure><img[^>]*src="images\/banner\.png"[^>]*><figcaption>My Image Description<\/figcaption><\/figure>/)
  assert.doesNotMatch(html, /class="[^"]*caption/)
})

test('createMarkdownRenderer keeps other classes on a "caption" image after removing the marker', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('![My Image Description](images/banner.png){.caption .center}\n')
  assert.match(html, /<img[^>]*class="center"/)
})

test('createMarkdownRenderer renders a plain "float-left" image without a figure wrapper', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('![My Image Description](images/banner.png){.float-left}\n')
  assert.doesNotMatch(html, /<figure>/)
  assert.match(html, /<img[^>]*class="float-left"/)
})

test('createMarkdownRenderer supports the =WIDTHxHEIGHT image size syntax', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('![alt](images/banner.png =300x200)\n')
  assert.match(html, /<img[^>]*width="300"[^>]*height="200"/)
})

test('createMarkdownRenderer supports a width-only size (=WIDTHx)', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('![alt](images/banner.png =150x)\n')
  assert.match(html, /<img[^>]*width="150"/)
  assert.doesNotMatch(html, /height=/)
})

test('createMarkdownRenderer supports a height-only size (=xHEIGHT)', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('![alt](images/banner.png =x200)\n')
  assert.match(html, /<img[^>]*height="200"/)
  assert.doesNotMatch(html, /width=/)
})

test('createMarkdownRenderer combines the size syntax with {.caption} and other classes', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('![My caption](images/banner.png =300x200){.caption .center}\n')
  assert.match(html, /<figure><img[^>]*width="300"[^>]*height="200"[^>]*class="center"[^>]*><figcaption>My caption<\/figcaption><\/figure>/)
})

test('createMarkdownRenderer falls back to a plain image when the size syntax is malformed', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('![alt](images/banner.png =0x0)\n')
  assert.doesNotMatch(html, /width=/)
  assert.match(html, /=0x0/)
})

function rollTableSource(headerLink, { title } = {}) {
  return [
    ...(title ? [`## ${title} {.table-title}`, ''] : []),
    `|${headerLink}|Encounter|`,
    '|:---:|:---|',
    '|2-3|3 Kobolds|',
    '|4-5|2 Owlbears|',
    '',
  ].join('\n')
}

test('installRollTableDetection records a table whose header links to /roll/... on env.inlineRollTables', () => {
  const markdown = createMarkdownRenderer()
  const env = { pageName: 'My Page', pageSlug: 'my-page' }
  markdown.render(rollTableSource('[2d6](/roll/2d6)'), env)

  assert.equal(env.inlineRollTables.length, 1)
  const table = env.inlineRollTables[0].data
  assert.equal(table.name, 'My Page — Encounter')
  assert.equal(table.slug, 'my-page-encounter')
  assert.deepEqual(table.columns, [{ name: '2d6' }, { name: 'Encounter' }])
  assert.deepEqual(table.rows, [
    ['2-3', '3 Kobolds'],
    ['4-5', '2 Owlbears'],
  ])
  assert.equal(table.rollMode, undefined)
})

test('installRollTableDetection ignores a plain table with no /roll/ link in its header', () => {
  const markdown = createMarkdownRenderer()
  const env = { pageName: 'My Page', pageSlug: 'my-page' }
  markdown.render('|A|B|\n|---|---|\n|1|2|\n', env)

  assert.equal(env.inlineRollTables, undefined)
})

test('installRollTableDetection reads rollMode from a {.no-repeat} marker on the header link', () => {
  const markdown = createMarkdownRenderer()
  const env = {}
  const html = markdown.render(rollTableSource('[2d6](/roll/2d6){.no-repeat}'), env)

  assert.equal(env.inlineRollTables[0].data.rollMode, 'noRepeat')
  // The marker shouldn't leak into the rendered link as a stray class.
  assert.doesNotMatch(html, /no-repeat/)
})

test('installRollTableDetection reads rollMode from a {.each-row} marker on the header link', () => {
  const markdown = createMarkdownRenderer()
  const env = {}
  markdown.render(rollTableSource('[2d6](/roll/2d6){.each-row}'), env)

  assert.equal(env.inlineRollTables[0].data.rollMode, 'eachRow')
})

test('installRollTableDetection names the table after a preceding {.table-title} heading instead of the default scheme', () => {
  const markdown = createMarkdownRenderer()
  const env = { pageName: 'My Page', pageSlug: 'my-page' }
  const html = markdown.render(rollTableSource('[2d6](/roll/2d6)', { title: 'Encounter Table' }), env)

  assert.equal(env.inlineRollTables[0].data.name, 'Encounter Table')
  assert.equal(env.inlineRollTables[0].data.slug, 'my-page-encounter-table')
  // The heading itself still renders normally in the page.
  assert.match(html, /<h2 class="table-title"[^>]*>Encounter Table<\/h2>/)
})

test('installRollTableDetection does not let an older {.table-title} heading apply to a later, unrelated table', () => {
  const markdown = createMarkdownRenderer()
  const env = { pageName: 'My Page', pageSlug: 'my-page' }
  const source = [
    '## First Table {.table-title}',
    '',
    '|[2d6](/roll/2d6)|Encounter|',
    '|:---:|:---|',
    '|2-3|3 Kobolds|',
    '',
    '## Just Some Heading',
    '',
    '|[1d4](/roll/1d4)|Item|',
    '|:---:|:---|',
    '|1|Sword|',
    '',
  ].join('\n')
  markdown.render(source, env)

  assert.equal(env.inlineRollTables.length, 2)
  assert.equal(env.inlineRollTables[0].data.name, 'First Table')
  assert.equal(env.inlineRollTables[1].data.name, 'My Page — Item')
})

test('installRollTableDetection appends a "(2)" suffix when two auto-named tables on the same page collide', () => {
  const markdown = createMarkdownRenderer()
  const env = { pageName: 'My Page', pageSlug: 'my-page' }
  // markdown-it-multimd-table merges two tables separated by a single blank
  // line into one multi-tbody table (its own "multibody" feature) — a
  // second blank line is what keeps these genuinely separate tables.
  const source = [rollTableSource('[2d6](/roll/2d6)'), '', rollTableSource('[2d8](/roll/2d8)')].join('\n')
  markdown.render(source, env)

  assert.equal(env.inlineRollTables.length, 2)
  assert.equal(env.inlineRollTables[0].data.slug, 'my-page-encounter')
  assert.equal(env.inlineRollTables[1].data.slug, 'my-page-encounter-2')
  assert.equal(env.inlineRollTables[1].data.name, 'My Page — Encounter (2)')
})

test('installRollTableDetection falls back to reading name/slug off the raw front matter when env.pageName/pageSlug are unset (preview path)', () => {
  const markdown = createMarkdownRenderer()
  const env = {}
  markdown.render(`---\nname: Ma Page\nslug: ma-page\n---\n\n${rollTableSource('[2d6](/roll/2d6)')}`, env)

  assert.equal(env.inlineRollTables[0].data.slug, 'ma-page-encounter')
  assert.equal(env.inlineRollTables[0].data.name, 'Ma Page — Encounter')
})

test('createMarkdownRenderer({ preview: true }) appends a roll-table caption after the table, in French when language is "fr"', () => {
  const markdown = createMarkdownRenderer({ preview: true, language: 'fr' })
  const html = markdown.render(rollTableSource('[2d6](/roll/2d6)'), {})

  assert.match(html, /<div class="mpx-roll-table-caption">/)
  assert.match(html, /Détectée comme roll table/)
  assert.match(html, /<span class="mpx-roll-table-caption-slug">page-encounter<\/span>/)
})

test('createMarkdownRenderer (build mode, not preview) never emits the roll-table caption', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render(rollTableSource('[2d6](/roll/2d6)'), {})

  assert.doesNotMatch(html, /mpx-roll-table-caption/)
})
