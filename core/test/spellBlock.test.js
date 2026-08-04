const assert = require('node:assert/strict')
const test = require('node:test')

const { createMarkdownRenderer } = require('../dist/index.js')

function renderSpell(yamlBody) {
  const markdown = createMarkdownRenderer()
  return markdown.render('```spell\n' + yamlBody + '\n```\n')
}

test('renders a leveled spell heading, casting time, range, components, and duration (Aid)', () => {
  const html = renderSpell(`
name: Aid
level: 2
school: abjuration
classes:
  - Bard
  - Cleric
  - Druid
  - Paladin
  - Ranger
activation:
  time: 1
  unit: action
rangeType: touch
components: [V, S, M]
componentsDetail: a strip of white cloth
durationUnit: hour
duration: 8
descr: "Choose up to three creatures within range. Each target's Hit Point maximum and current Hit Points increase by 5 for the duration."
`)

  assert.match(html, /<div class="compendium-block-title">Aid<\/div>/)
  assert.match(html, /<div class="compendium-block-heading">Level 2 Abjuration \(Bard, Cleric, Druid, Paladin, Ranger\)<\/div>/)
  assert.match(html, /Casting Time: <\/span><span class="compendium-block-detail-value">Action</)
  assert.match(html, /Range: <\/span><span class="compendium-block-detail-value">Touch</)
  assert.match(html, /Components: <\/span><span class="compendium-block-detail-value">V, S, M \(a strip of white cloth\)</)
  assert.match(html, /Duration: <\/span><span class="compendium-block-detail-value">8 Hours</)
})

test('renders a cantrip heading with school before "Cantrip" (Blade Ward)', () => {
  const html = renderSpell(`
name: Blade Ward
level: 0
school: abjuration
classes: [Bard, Sorcerer, Warlock, Wizard]
activation:
  time: 1
  unit: action
rangeType: self
components: [V, S]
durationType: concentration
duration: 1
durationUnit: minute
`)

  assert.match(html, /<div class="compendium-block-heading">Abjuration Cantrip \(Bard, Sorcerer, Warlock, Wizard\)<\/div>/)
  assert.match(html, /Duration: <\/span><span class="compendium-block-detail-value">Concentration, up to 1 Minute</)
})

test('appends "or Ritual" to casting time when ritual is true (Animal Messenger)', () => {
  const html = renderSpell(`
name: Animal Messenger
level: 2
school: enchantment
ritual: true
activation:
  time: 1
  unit: action
rangeType: unlimited
`)

  assert.match(html, /Casting Time: <\/span><span class="compendium-block-detail-value">Action or Ritual</)
})

test('renders a numeric range in feet when rangeType is unset (Animate Objects)', () => {
  const html = renderSpell(`
name: Animate Objects
level: 5
school: transmutation
activation:
  time: 1
  unit: action
range: 120
components: [V, S]
durationType: concentration
duration: 1
durationUnit: minute
`)

  assert.match(html, /Range: <\/span><span class="compendium-block-detail-value">120 feet</)
})

test('renders "Until dispelled" for a dispel duration type with no duration value (Arcane Lock)', () => {
  const html = renderSpell(`
name: Arcane Lock
level: 2
school: abjuration
classes: [Wizard]
activation:
  time: 1
  unit: action
rangeType: touch
components: [V, S, M]
componentsDetail: gold dust worth 25+ GP, which the spell consumes
durationType: dispel
`)

  assert.match(html, /Duration: <\/span><span class="compendium-block-detail-value">Until dispelled</)
})

test('omits a detail line entirely when its data is absent', () => {
  const html = renderSpell(`
name: Minimal Spell
`)
  assert.doesNotMatch(html, /compendium-block-detail-label/)
  assert.doesNotMatch(html, /compendium-block-heading/)
})

test('renders the description through the shared Markdown renderer', () => {
  const html = renderSpell(`
name: Fireball
descr: "A **bright** streak flashes."
`)
  assert.match(html, /<div class="compendium-block-description">.*<strong>bright<\/strong>.*<\/div>/s)
})

test('shows a spell-block-error and skips rendering when the YAML is invalid', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('```spell\nname: [unterminated\n```\n')
  assert.match(html, /spell-block-error/)
})

test('shows a spell-block-error when name is missing', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('```spell\nlevel: 1\n```\n')
  assert.match(html, /spell-block-error/)
  assert.match(html, /non-empty name/)
})

test('hints at an unclosed previous ```spell block when a bare ``` line ends up inside the YAML', () => {
  const markdown = createMarkdownRenderer()
  // No closing ``` after "name: A" — its content swallows the second
  // block's own opening fence as literal (invalid) YAML text.
  const html = markdown.render('```spell\nname: A\n```spell\nname: B\n```\n')
  assert.match(html, /spell-block-error/)
  assert.match(html, /missing its closing/)
})

test('does not add the unclosed-fence hint for an unrelated YAML error', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('```spell\nname: [unterminated\n```\n')
  assert.match(html, /spell-block-error/)
  assert.doesNotMatch(html, /missing its closing/)
})

test('treats range: 0 and areaEffectSize: 0 as not set, not a literal 0 feet', () => {
  const html = renderSpell(`
name: Test Spell
range: 0
areaEffectSize: 0
`)
  assert.doesNotMatch(html, /compendium-block-detail-label">Range/)
})

test('leaves the optional enum placeholders as an empty string, not null, so an untouched snippet renders cleanly', () => {
  const html = renderSpell(`
name: New Spell
school: ""
rangeType: ""
durationType: ""
durationUnit: ""
activation:
  time: 0
  unit: ""
`)
  assert.doesNotMatch(html, /spell-block-error/)
})

test('records the parsed spell on env.inlineSpells for later build merging', () => {
  const markdown = createMarkdownRenderer()
  const env = {}
  markdown.render('```spell\nname: Fireball\nlevel: 3\n```\n', env)
  assert.equal(env.inlineSpells.length, 1)
  assert.equal(env.inlineSpells[0].data.name, 'Fireball')
  assert.equal(env.inlineSpells[0].data.data.level, 3)
})

test('converts range from feet to meters (x0.3) when measurement is metric', () => {
  const markdown = createMarkdownRenderer({ measurement: 'metric' })
  const html = markdown.render('```spell\nname: Test\nrange: 30\n```\n')
  assert.match(html, /9 meters/)
})

test('rounds a metric range conversion to the nearest half-meter', () => {
  const markdown = createMarkdownRenderer({ measurement: 'metric' })
  const html = markdown.render('```spell\nname: Test\nrange: 25\n```\n')
  assert.match(html, /7\.5 meters/)
})

test('shows the French unit word "mètre" for a metric range when language is "fr"', () => {
  const markdown = createMarkdownRenderer({ measurement: 'metric', language: 'fr' })
  const html = markdown.render('```spell\nname: Test\nrange: 30\n```\n')
  assert.match(html, /9 mètre/)
})

test('uses a non-breaking space before the colon in French detail labels', () => {
  const markdown = createMarkdownRenderer({ language: 'fr' })
  const html = markdown.render('```spell\nname: Test\nlevel: 1\nschool: abjuration\ncomponents: [V]\n```\n')
  assert.match(html, /Composantes&nbsp;: /)
})

test('reverses the French spell heading order (school before level, not after)', () => {
  const markdown = createMarkdownRenderer({ language: 'fr' })
  const html = markdown.render(
    '```spell\nname: Test\nlevel: 2\nschool: transmutation\nclasses: [Barde, Druide]\n```\n',
  )
  assert.match(html, /<div class="compendium-block-heading">Transmutation du 2e niveau \(Barde, Druide\)<\/div>/)
})

test('uses "1er niveau" (not "1e niveau") as the French ordinal for level 1', () => {
  const markdown = createMarkdownRenderer({ language: 'fr' })
  const html = markdown.render('```spell\nname: Test\nlevel: 1\nschool: divination\n```\n')
  assert.match(html, /Divination du 1er niveau/)
})

test('renders a French cantrip as "{École} mineur(e)", gender-agreed with the school', () => {
  const markdown = createMarkdownRenderer({ language: 'fr' })
  const feminineHtml = markdown.render('```spell\nname: Test\nlevel: 0\nschool: necromancy\n```\n')
  assert.match(feminineHtml, /Nécromancie mineure/)

  const masculineHtml = markdown.render('```spell\nname: Test2\nlevel: 0\nschool: enchantment\n```\n')
  assert.match(masculineHtml, /Enchantement mineur\b/)
})

test('accepts a measurement getter re-read on every render, not resolved once', () => {
  let current = 'imperial'
  const markdown = createMarkdownRenderer({ measurement: () => current })

  const firstHtml = markdown.render('```spell\nname: Test\nrange: 30\n```\n')
  assert.match(firstHtml, /30 feet/)

  current = 'metric'
  const secondHtml = markdown.render('```spell\nname: Test\nrange: 30\n```\n')
  assert.match(secondHtml, /9 meters/)
})

test('converts area effect size from feet to meters when measurement is metric', () => {
  const markdown = createMarkdownRenderer({ measurement: 'metric' })
  const html = markdown.render('```spell\nname: Test\nrangeType: self\nareaEffectShape: sphere\nareaEffectSize: 20\n```\n')
  assert.match(html, /\(6 m <img/)
})

test('a normal fenced code block (non-spell) still renders as a regular code block', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('```js\nconst x = 1;\n```\n')
  assert.match(html, /<pre>/)
  assert.doesNotMatch(html, /compendium-block/)
})

test('renders Source and Tags detail lines when present', () => {
  const html = renderSpell(`
name: Test Spell
sources:
  - name: Player's Handbook
    page: 241
tags: [damage, fire]
`)
  assert.match(html, /Source: <\/span><span class="compendium-block-detail-value">Player's Handbook p\.241</)
  assert.match(html, /Tags: <\/span><span class="compendium-block-detail-value">damage, fire</)
  assert.match(html, /<div class="compendium-block-details compendium-block-details-footer">/)
})

test('hides Source when showSources is false', () => {
  const html = renderSpell(`
name: Test Spell
sources:
  - name: Player's Handbook
    page: 241
showSources: false
`)
  assert.doesNotMatch(html, /Source: /)
})

test('hides Tags when showTags is false', () => {
  const html = renderSpell(`
name: Test Spell
tags: [damage, fire]
showTags: false
`)
  assert.doesNotMatch(html, /Tags: /)
})

test('renders the school icon in build mode with an assets/img path', () => {
  const html = renderSpell(`
name: Fireball
school: evocation
`)
  assert.match(html, /<img class="spell-block-school-icon" src="assets\/img\/school-evocation\.webp" alt="Evocation">/)
})

test('renders the school icon with a ../ prefix in preview mode', () => {
  const markdown = createMarkdownRenderer({ preview: true })
  const html = markdown.render('```spell\nname: Fireball\nschool: evocation\n```\n')
  assert.match(html, /src="\.\.\/assets\/img\/school-evocation\.webp"/)
})

test('omits the school icon when school is unset', () => {
  const html = renderSpell(`
name: Fireball
`)
  assert.doesNotMatch(html, /spell-block-school-icon/)
})

test('appends an area effect size and shape icon to the Range detail line', () => {
  const html = renderSpell(`
name: Fireball
rangeType: self
areaEffectShape: sphere
areaEffectSize: 9
`)
  assert.match(
    html,
    /Range: <\/span><span class="compendium-block-detail-value">Self \(9 ft <img class="spell-block-shape-icon" src="assets\/img\/shape-sphere\.webp" alt="Sphere">\)<\/span>/,
  )
})

test('shows area size in feet units when measurement is imperial', () => {
  const markdown = createMarkdownRenderer({ measurement: 'imperial' })
  const html = markdown.render('```spell\nname: Test\nrangeType: self\nareaEffectShape: cone\nareaEffectSize: 15\n```\n')
  assert.match(html, /\(15 ft <img/)
})


test('renders the illustration image when image is set', () => {
  const html = renderSpell(`
name: Fireball
image: spells/fireball.png
`)
  assert.match(html, /<div class="compendium-image-block"><img class="compendium-image" src="spells\/fireball\.png" alt=""><\/div>/)
})

test('rewrites the illustration image path with a ../ prefix in preview mode (pages/ is one level deeper than spells/)', () => {
  const markdown = createMarkdownRenderer({ preview: true })
  const html = markdown.render('```spell\nname: Fireball\nimage: spells/fireball.png\n```\n')
  assert.match(html, /src="\.\.\/spells\/fireball\.png"/)
})

test('treats the untouched "spells/" placeholder as no image set, not a broken path', () => {
  const html = renderSpell(`
name: Fireball
image: spells/
`)
  assert.doesNotMatch(html, /compendium-image-block/)
})

test('hides the illustration image when showImage is false', () => {
  const html = renderSpell(`
name: Fireball
image: spells/fireball.png
showImage: false
`)
  assert.doesNotMatch(html, /compendium-image-block/)
})

test('hides the school icon when showSchoolIcon is false', () => {
  const html = renderSpell(`
name: Fireball
school: evocation
showSchoolIcon: false
`)
  assert.doesNotMatch(html, /spell-block-school-icon/)
})

test('falls back to the shape text label when showAreaEffectIcon is false', () => {
  const html = renderSpell(`
name: Fireball
rangeType: self
areaEffectShape: sphere
areaEffectSize: 9
showAreaEffectIcon: false
`)
  assert.doesNotMatch(html, /spell-block-shape-icon/)
  assert.match(html, /\(9 ft Sphere\)/)
})

test('a project displayDefault of false hides an element when the spell leaves the show* field absent', () => {
  const markdown = createMarkdownRenderer({ spellDisplayDefaults: { showSchoolIcon: false } })
  const html = markdown.render('```spell\nname: Fireball\nschool: evocation\n```\n')
  assert.doesNotMatch(html, /spell-block-school-icon/)
})

test("an explicit show* field in the spell's own YAML always wins over a project displayDefault", () => {
  const markdown = createMarkdownRenderer({ spellDisplayDefaults: { showSchoolIcon: false } })
  const html = markdown.render('```spell\nname: Fireball\nschool: evocation\nshowSchoolIcon: true\n```\n')
  assert.match(html, /spell-block-school-icon/)
})

test('accepts a spellDisplayDefaults getter re-read on every render, not resolved once', () => {
  let showTags = true
  const markdown = createMarkdownRenderer({ spellDisplayDefaults: () => ({ showTags }) })

  const firstHtml = markdown.render('```spell\nname: Test\ntags: [fire]\n```\n')
  assert.match(firstHtml, /Tags: /)

  showTags = false
  const secondHtml = markdown.render('```spell\nname: Test\ntags: [fire]\n```\n')
  assert.doesNotMatch(secondHtml, /Tags: /)
})

test('maps the "square" area effect shape to its own dedicated icon (not cube)', () => {
  const html = renderSpell(`
name: Fireball
rangeType: self
areaEffectShape: square
areaEffectSize: 10
`)
  assert.match(html, /src="assets\/img\/shape-square\.webp" alt="Square"/)
})
