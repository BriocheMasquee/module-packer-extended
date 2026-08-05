const assert = require('node:assert/strict')
const test = require('node:test')

const { createMarkdownRenderer } = require('../dist/index.js')

function renderItem(yamlBody) {
  const markdown = createMarkdownRenderer()
  return markdown.render('```item\n' + yamlBody + '\n```\n')
}

test('renders name, type/rarity subtitle, weight, value, damage, mastery, range, properties', () => {
  const html = renderItem(`
name: Outil exhaustif arme
attunement: true
attunementDetail: Une précision
dmg1: 1d12
dmgType: necrotic
mastery: push
properties: [nick, cleave]
range: 12/24
rarity: legendary
type: meleeWeapon
typeDetail: Un détail
value: 10
weight: 12
`)

  assert.match(html, /<div class="compendium-block-title">Outil exhaustif arme<\/div>/)
  assert.match(html, /<div class="compendium-block-heading">Melee Weapon \(Un détail\), Legendary<\/div>/)
  assert.match(html, /Weight: <\/span><span class="compendium-block-detail-value">12 lb</)
  assert.match(html, /Value: <\/span><span class="compendium-block-detail-value">10 gp</)
  assert.match(html, /Damage: <\/span><span class="compendium-block-detail-value">1d12 Necrotic</)
  assert.match(html, /Mastery: <\/span><span class="compendium-block-detail-value">Push</)
  assert.match(html, /Range: <\/span><span class="compendium-block-detail-value">12\/24</)
  assert.match(html, /Properties: <\/span><span class="compendium-block-detail-value">Nick, Cleave</)
  assert.match(html, /<p class="compendium-block-detail">Requires Attunement \(Une précision\)<\/p>/)
})

test('renders a simple tool with just rarity/type/value/weight', () => {
  const html = renderItem(`
name: Outil exhaustif outil
rarity: rare
type: tool
value: 12
weight: 1
`)

  assert.match(html, /<div class="compendium-block-heading">Tool, Rare<\/div>/)
  assert.match(html, /Weight: <\/span><span class="compendium-block-detail-value">1 lb</)
  assert.match(html, /Value: <\/span><span class="compendium-block-detail-value">12 gp</)
  assert.doesNotMatch(html, /Damage: /)
  assert.doesNotMatch(html, /Requires Attunement/)
})

test('shows weight/capacity in kg when measurement is metric, with no numeric conversion', () => {
  const markdown = createMarkdownRenderer({ measurement: 'metric' })
  const html = markdown.render('```item\nname: Test\nweight: 12\ncontainer: true\ncapacity: 30\n```\n')
  assert.match(html, /Weight: <\/span><span class="compendium-block-detail-value">12 kg</)
  assert.match(html, /Container Capacity: <\/span><span class="compendium-block-detail-value">30 kg</)
})

test('shows weight in lb when measurement is imperial', () => {
  const html = renderItem('name: Test\nweight: 5')
  assert.match(html, /Weight: <\/span><span class="compendium-block-detail-value">5 lb</)
})

test('converts weight/capacity from lb to kg when the item was authored imperial but the project is metric', () => {
  const markdown = createMarkdownRenderer({ measurement: 'metric' })
  const html = markdown.render(
    '```item\nname: Test\nattributes:\n  measurement: imperial\nweight: 10\ncontainer: true\ncapacity: 20\n```\n',
  )
  assert.match(html, /Weight: <\/span><span class="compendium-block-detail-value">5 kg</)
  assert.match(html, /Container Capacity: <\/span><span class="compendium-block-detail-value">10 kg</)
})

test('converts weight from kg to lb when the item was authored metric but the project is imperial', () => {
  const html = renderItem('name: Test\nattributes:\n  measurement: metric\nweight: 9')
  assert.match(html, /Weight: <\/span><span class="compendium-block-detail-value">18 lb</)
})

test('treats weight: 0 and value: 0 as not set', () => {
  const html = renderItem('name: Test\nweight: 0\nvalue: 0')
  assert.doesNotMatch(html, /Weight: /)
  assert.doesNotMatch(html, /Value: /)
})

test('omits a detail line entirely when its data is absent', () => {
  const html = renderItem('name: Minimal Item')
  assert.doesNotMatch(html, /compendium-block-detail-label/)
  assert.doesNotMatch(html, /compendium-block-heading/)
})

test('treats the "custom" item type specially (no ItemType.Custom catalog entry)', () => {
  const html = renderItem('name: Test\ntype: custom')
  assert.match(html, /<div class="compendium-block-heading">Custom<\/div>/)
})

test('renders armor stats: AC, STR requirement, stealth disadvantage', () => {
  const html = renderItem(`
name: Test Armor
type: heavyArmor
ac: 18
str: 15
stealth: true
`)
  assert.match(html, /AC: <\/span><span class="compendium-block-detail-value">18</)
  assert.match(html, /STR Requirement: <\/span><span class="compendium-block-detail-value">15</)
  assert.match(html, /<p class="compendium-block-detail">Stealth Check Disadvantage<\/p>/)
})

test('renders the description through the shared Markdown renderer', () => {
  const html = renderItem('name: Test\ndescr: "A **bright** gem."')
  assert.match(html, /<div class="compendium-block-description">.*<strong>bright<\/strong>.*<\/div>/s)
})

test('renders Source and Tags detail lines when present', () => {
  const html = renderItem(`
name: Test Item
sources:
  - name: Player's Handbook
    page: 241
tags: [treasure]
`)
  assert.match(html, /Source: <\/span><span class="compendium-block-detail-value">Player's Handbook p\.241</)
  assert.match(html, /Tags: <\/span><span class="compendium-block-detail-value">treasure</)
})

test('hides Source when showSources is false', () => {
  const html = renderItem('name: Test\nsources:\n  - name: Book\n    page: 1\nshowSources: false')
  assert.doesNotMatch(html, /Source: /)
})

test('hides Tags when showTags is false', () => {
  const html = renderItem('name: Test\ntags: [a]\nshowTags: false')
  assert.doesNotMatch(html, /Tags: /)
})

test('renders the illustration image after Source/Tags, not before', () => {
  const html = renderItem('name: Test\nimage: items/ring.png\nsources:\n  - name: Book\n    page: 1')
  const imageIndex = html.indexOf('compendium-image-block')
  const sourceIndex = html.indexOf('Source: ')
  assert.ok(imageIndex > sourceIndex, 'image should render after the Source line')
})

test('hides the illustration image when showImage is false', () => {
  const html = renderItem('name: Test\nimage: items/ring.png\nshowImage: false')
  assert.doesNotMatch(html, /compendium-image-block/)
})

test('rewrites the illustration image path with a ../ prefix in preview mode (pages/ is one level deeper than items/)', () => {
  const markdown = createMarkdownRenderer({ preview: true })
  const html = markdown.render('```item\nname: Test\nimage: items/ring.png\n```\n')
  assert.match(html, /src="\.\.\/items\/ring\.png"/)
})

test('treats the untouched "items/" placeholder as no image set', () => {
  const html = renderItem('name: Test\nimage: items/')
  assert.doesNotMatch(html, /compendium-image-block/)
})

test('a project displayDefault of false hides Tags when the item leaves showTags absent', () => {
  const markdown = createMarkdownRenderer({ itemDisplayDefaults: { showTags: false } })
  const html = markdown.render('```item\nname: Test\ntags: [a]\n```\n')
  assert.doesNotMatch(html, /Tags: /)
})

test("an explicit show* field in the item's own YAML always wins over a project displayDefault", () => {
  const markdown = createMarkdownRenderer({ itemDisplayDefaults: { showTags: false } })
  const html = markdown.render('```item\nname: Test\ntags: [a]\nshowTags: true\n```\n')
  assert.match(html, /Tags: /)
})

test('shows an item-block-error and skips rendering when the YAML is invalid', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('```item\nname: [unterminated\n```\n')
  assert.match(html, /item-block-error/)
})

test('shows an item-block-error when name is missing', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('```item\nrarity: rare\n```\n')
  assert.match(html, /item-block-error/)
  assert.match(html, /non-empty name/)
})

test('hints at an unclosed previous ```item block when a bare ``` line ends up inside the YAML', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('```item\nname: A\n```item\nname: B\n```\n')
  assert.match(html, /item-block-error/)
  assert.match(html, /missing its closing/)
})

test('records the parsed item on env.inlineItems for later build merging', () => {
  const markdown = createMarkdownRenderer()
  const env = {}
  markdown.render('```item\nname: Ring of Protection\nrarity: rare\n```\n', env)
  assert.equal(env.inlineItems.length, 1)
  assert.equal(env.inlineItems[0].data.name, 'Ring of Protection')
  assert.equal(env.inlineItems[0].data.data.rarity, 'rare')
})

test('a normal fenced code block (non-item, non-spell) still renders as a regular code block', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('```js\nconst x = 1;\n```\n')
  assert.match(html, /<pre>/)
  assert.doesNotMatch(html, /compendium-block/)
})

test('an inline spell block still renders correctly alongside item block support', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('```spell\nname: Fireball\nlevel: 3\n```\n')
  assert.match(html, /<div class="compendium-block-title">Fireball<\/div>/)
})

test('gender-agrees French "peu courant" to "peu courante" for a feminine item type (e.g. weapon)', () => {
  const markdown = createMarkdownRenderer({ language: 'fr' })
  const html = markdown.render('```item\nname: Test\ntype: meleeWeapon\nrarity: uncommon\n```\n')
  assert.match(html, /<div class="compendium-block-heading">Arme de corps à corps, Peu courante<\/div>/)
})

test('uses a non-breaking space before the colon in French detail labels', () => {
  const markdown = createMarkdownRenderer({ language: 'fr' })
  const html = markdown.render('```item\nname: Test\nweight: 2\n```\n')
  assert.match(html, /Poids&nbsp;: /)
})

test('leaves French rarity masculine for a masculine item type (e.g. ring)', () => {
  const markdown = createMarkdownRenderer({ language: 'fr' })
  const html = markdown.render('```item\nname: Test\ntype: ring\nrarity: common\n```\n')
  assert.match(html, /<div class="compendium-block-heading">Anneau, Courant<\/div>/)
})
