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
