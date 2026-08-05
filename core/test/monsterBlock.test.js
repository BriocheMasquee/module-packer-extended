const assert = require('node:assert/strict')
const test = require('node:test')

const { createMarkdownRenderer } = require('../dist/index.js')

function renderMonster(yamlBody) {
  const markdown = createMarkdownRenderer()
  return markdown.render('```monster\n' + yamlBody + '\n```\n')
}

function renderMonsterWithClass(classAttr, yamlBody) {
  const markdown = createMarkdownRenderer()
  return markdown.render('```monster {' + classAttr + '}\n' + yamlBody + '\n```\n')
}

const ARCH_HAG_YAML = `
name: Arch-Hag
size: L
type: fey
alignment: NE
ac: "20"
hp: 333 (29d10 + 174)
speed:
  walk: 40
abilities: { str: 24, dex: 15, con: 23, int: 19, wis: 19, cha: 25 }
savingThrows: { str: 7, dex: 9, con: 6, int: 4, wis: 11, cha: 7 }
skills: { deception: 14, perception: 11, persuasion: 21 }
damageResistances: [cold, fire, psychic]
conditionImmunities: [Charmed, Exhaustion, Frightened]
senses:
  truesight: 60
passivePerception: 21
languages: [All]
cr: "21"
initiativeBonus: 16
proficiencyBonus: 7
traits:
  - name: Legendary Resistance
    usage: 4/Day, or 5/Day in Lair
    text: If the hag fails a saving throw, it can choose to succeed instead.
actions:
  - name: Multiattack
    text: The hag makes two Spectral Claw attacks and uses Crackling Wave.
legendaryActions:
  - name: Hag's Swipe
    text: The hag makes one Spectral Claw attack.
`

test('renders name, subtitle (size/type/alignment), AC/Initiative/HP/Speed', () => {
  const html = renderMonster(ARCH_HAG_YAML)
  assert.match(html, /<div class="statblock-title">Arch-Hag<\/div>/)
  assert.match(html, /<div class="statblock-subtitle">Large Fey, Neutral Evil<\/div>/)
  assert.match(html, /<span class="statblock-topstat-name">AC<\/span> 20/)
  assert.match(html, /<span class="statblock-topstat-name">Initiative<\/span> <strong>\+16<\/strong> \(26\)/)
  assert.match(html, /<span class="statblock-topstat-name">HP<\/span> 333 \(29d10 \+ 174\)/)
  assert.match(html, /<span class="statblock-topstat-name">Speed<\/span> 40 ft\./)
})

test('renders the ability score table with correct abbreviations, mod, and save', () => {
  const html = renderMonster(ARCH_HAG_YAML)
  assert.match(
    html,
    /<div class="statblock-ability-row"><strong>STR<\/strong><span>24<\/span><span>\+7<\/span><span>\+7<\/span><\/div>/,
  )
  assert.match(
    html,
    /<div class="statblock-ability-row"><strong>DEX<\/strong><span>15<\/span><span>\+2<\/span><span>\+9<\/span><\/div>/,
  )
  assert.match(
    html,
    /<div class="statblock-ability-row"><strong>CHA<\/strong><span>25<\/span><span>\+7<\/span><span>\+7<\/span><\/div>/,
  )
})

test('only lists a saving throw when it diverges from the plain ability modifier', () => {
  const html = renderMonster(ARCH_HAG_YAML)
  assert.match(html, /Saving Throws: <\/span>DEX \+9, WIS \+11/)
  assert.doesNotMatch(html, /STR \+7,? *Saving Throws/)
})

test('renders skills sorted alphabetically by label', () => {
  const html = renderMonster(ARCH_HAG_YAML)
  assert.match(html, /Skills: <\/span>Deception \+14, Perception \+11, Persuasion \+21/)
})

test('renders resistances, condition immunities, senses with passive perception, languages', () => {
  const html = renderMonster(ARCH_HAG_YAML)
  assert.match(html, /Resistances: <\/span>Cold, Fire, Psychic/)
  assert.match(html, /Condition Immunities: <\/span>Charmed, Exhaustion, Frightened/)
  assert.match(html, /Senses: <\/span>Truesight 60 ft\.; Passive Perception 21/)
  assert.match(html, /Languages: <\/span>All/)
})

test('renders challenge rating with the derived XP and proficiency bonus', () => {
  const html = renderMonster(ARCH_HAG_YAML)
  assert.match(html, /Challenge: <\/span>21 \(XP 33,000; PB \+7\)/)
})

test('renders traits/actions/legendary actions with name(usage). text, using kebab-case CSS classes', () => {
  const html = renderMonster(ARCH_HAG_YAML)
  assert.match(html, /<div class="statblock-section-title">Traits<\/div>/)
  assert.match(
    html,
    /<span class="statblock-trait-name">Legendary Resistance \(4\/Day, or 5\/Day in Lair\)\.<\/span> <span class="statblock-trait-description">If the hag fails/,
  )
  assert.match(html, /<div class="statblock-section-title">Actions<\/div>/)
  assert.match(html, /<span class="statblock-action-name">Multiattack\.<\/span>/)
  assert.match(html, /<div class="statblock-section-title">Legendary Actions<\/div>/)
  assert.match(html, /<div class="statblock-legendary-action">/)
  assert.match(html, /<span class="statblock-legendary-action-name">Hag's Swipe\.<\/span>/)
})

test('omits a property line entirely when its data is absent', () => {
  const html = renderMonster('name: Minimal Monster')
  assert.doesNotMatch(html, /statblock-property-name/)
  assert.doesNotMatch(html, /statblock-subtitle/)
  assert.doesNotMatch(html, /statblock-abilities/)
})

test('renders the description through the shared Markdown renderer', () => {
  const html = renderMonster('name: Test\ndescr: "A **fearsome** beast."')
  assert.match(html, /<strong>fearsome<\/strong>/)
})

test('renders Source and Tags outside the card, in the shared compendium-block-details-footer style', () => {
  const html = renderMonster(`
name: Test Monster
sources:
  - name: Monster Manual
    page: 328
tags: [dragon]
`)
  // Closed before the footer, not a .statblock-property-line inside it.
  const statblockCloseIndex = html.indexOf('</div><div class="compendium-block-details')
  assert.ok(statblockCloseIndex > -1, 'footer should immediately follow the closed .statblock')
  assert.match(
    html,
    /<span class="compendium-block-detail-label">Source: <\/span><span class="compendium-block-detail-value">Monster Manual p\.328<\/span>/,
  )
  assert.match(
    html,
    /<span class="compendium-block-detail-label">Tags: <\/span><span class="compendium-block-detail-value">dragon<\/span>/,
  )
  assert.doesNotMatch(html, /statblock-property-name">Source/)
  assert.doesNotMatch(html, /statblock-property-name">Tags/)
})

test('hides Source when showSources is false', () => {
  const html = renderMonster('name: Test\nsources:\n  - name: Book\n    page: 1\nshowSources: false')
  assert.doesNotMatch(html, /Source: /)
})

test('hides Tags when showTags is false', () => {
  const html = renderMonster('name: Test\ntags: [a]\nshowTags: false')
  assert.doesNotMatch(html, /Tags: /)
})

test('renders the token image and the illustration image, both hidden when their toggle is false', () => {
  const withImages = renderMonster('name: Test\nimage: monsters/dragon.png\ntoken: monsters/dragon-token.png')
  assert.match(withImages, /<img class="statblock-token" src="monsters\/dragon-token\.png" alt="">/)
  assert.match(withImages, /<img class="statblock-image" src="monsters\/dragon\.png" alt="">/)

  const hidden = renderMonster(
    'name: Test\nimage: monsters/dragon.png\ntoken: monsters/dragon-token.png\nshowImage: false\nshowToken: false',
  )
  assert.doesNotMatch(hidden, /statblock-token/)
  assert.doesNotMatch(hidden, /statblock-image/)
})

test('rewrites both the token and illustration image paths with a ../ prefix in preview mode', () => {
  const markdown = createMarkdownRenderer({ preview: true })
  const html = markdown.render('```monster\nname: Test\nimage: monsters/dragon.png\ntoken: monsters/dragon-token.png\n```\n')
  assert.match(html, /src="\.\.\/monsters\/dragon-token\.png"/)
  assert.match(html, /src="\.\.\/monsters\/dragon\.png"/)
})

test('treats the untouched "monsters/" placeholder as no image/token set', () => {
  const html = renderMonster('name: Test\nimage: monsters/\ntoken: monsters/')
  assert.doesNotMatch(html, /statblock-token/)
  assert.doesNotMatch(html, /statblock-image/)
})

test('adds the color/two-column class only when requested via a {.class} fence annotation, not a YAML field', () => {
  const plain = renderMonster('name: Test')
  assert.match(plain, /<div class="statblock">/)

  const colored = renderMonsterWithClass('.red .two-column', 'name: Test')
  assert.match(colored, /<div class="statblock red two-column">/)

  // A "color"/"twoColumn" YAML field is not a recognized field at all —
  // this is a presentation-only, fence-annotation-only concern.
  const ignored = renderMonster('name: Test\ncolor: red\ntwoColumn: true')
  assert.match(ignored, /<div class="statblock">/)
})

test('ignores an unrecognized color value in the fence annotation', () => {
  const html = renderMonsterWithClass('.notarealcolor', 'name: Test')
  assert.match(html, /<div class="statblock">/)
})

test('a project displayDefault of false hides Tags when the monster leaves showTags absent', () => {
  const markdown = createMarkdownRenderer({ monsterDisplayDefaults: { showTags: false } })
  const html = markdown.render('```monster\nname: Test\ntags: [a]\n```\n')
  assert.doesNotMatch(html, /Tags: /)
})

test("an explicit show* field in the monster's own YAML always wins over a project displayDefault", () => {
  const markdown = createMarkdownRenderer({ monsterDisplayDefaults: { showTags: false } })
  const html = markdown.render('```monster\nname: Test\ntags: [a]\nshowTags: true\n```\n')
  assert.match(html, /Tags: /)
})

test('shows a monster-block-error and skips rendering when the YAML is invalid', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('```monster\nname: [unterminated\n```\n')
  assert.match(html, /monster-block-error/)
})

test('shows a monster-block-error when name is missing', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('```monster\ncr: "1"\n```\n')
  assert.match(html, /monster-block-error/)
  assert.match(html, /non-empty name/)
})

test('hints at an unclosed previous ```monster block when a bare ``` line ends up inside the YAML', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('```monster\nname: A\n```monster\nname: B\n```\n')
  assert.match(html, /monster-block-error/)
  assert.match(html, /missing its closing/)
})

test('records the parsed monster on env.inlineMonsters for later build merging', () => {
  const markdown = createMarkdownRenderer()
  const env = {}
  markdown.render('```monster\nname: Young Dragon\ncr: "6"\n```\n', env)
  assert.equal(env.inlineMonsters.length, 1)
  assert.equal(env.inlineMonsters[0].data.name, 'Young Dragon')
  assert.equal(env.inlineMonsters[0].data.data.cr, '6')
})

test('a normal fenced code block still renders as a regular code block alongside monster support', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('```js\nconst x = 1;\n```\n')
  assert.match(html, /<pre>/)
  assert.doesNotMatch(html, /statblock/)
})

test('an inline item block still renders correctly alongside monster block support', () => {
  const markdown = createMarkdownRenderer()
  const html = markdown.render('```item\nname: Longsword\n```\n')
  assert.match(html, /<div class="compendium-block-title">Longsword<\/div>/)
})

test('renders speed with multiple movement modes and hover', () => {
  const html = renderMonster('name: Test\nspeed:\n  walk: 10\n  fly: 60\n  hover: true')
  assert.match(html, /Speed<\/span> 10 ft\., Fly 60 ft\. \(Hover\)/)
})

test('shows speed and senses as-authored (in meters, no feet conversion) when measurement is metric', () => {
  const markdown = createMarkdownRenderer({ measurement: 'metric' })
  const html = markdown.render('```monster\nname: Test\nspeed:\n  walk: 40\n  fly: 80\nsenses:\n  darkvision: 120\n```\n')
  assert.match(html, /Speed<\/span> 40 m\., Fly 80 m\./)
  assert.match(html, /Senses: <\/span>Darkvision 120 m\./)
})

test('shows speed/senses in feet when measurement is imperial (the default)', () => {
  const html = renderMonster('name: Test\nspeed:\n  walk: 40\nsenses:\n  darkvision: 120')
  assert.match(html, /Speed<\/span> 40 ft\./)
  assert.match(html, /Senses: <\/span>Darkvision 120 ft\./)
})

test('the "sleightOfHand" skill translates to "Sleight of Hand" (catalog casing exception)', () => {
  const html = renderMonster('name: Test\nskills: { sleightOfHand: 5 }')
  assert.match(html, /Skills: <\/span>Sleight of Hand \+5/)
})

test('renders labels in French when language is "fr"', () => {
  const markdown = createMarkdownRenderer({ language: 'fr' })
  const html = markdown.render(
    '```monster\nname: Test\nsize: L\ntype: fey\nskills: { perception: 5 }\nsenses:\n  darkvision: 60\n```\n',
  )
  assert.match(html, /Compétences&nbsp;: <\/span>Perception \+5/)
  assert.match(html, /Sens&nbsp;: <\/span>Vision dans le noir 60 ft\./)
  assert.match(html, /<div class="statblock-subtitle">Fée de taille G<\/div>/)
})

test('uses a non-breaking space before the colon in French labels ("Compétences&nbsp;: "), plain colon in English', () => {
  const frenchHtml = createMarkdownRenderer({ language: 'fr' }).render('```monster\nname: Test\nskills: { perception: 5 }\n```\n')
  assert.match(frenchHtml, /Compétences&nbsp;: /)
  const englishHtml = renderMonster('name: Test\nskills: { perception: 5 }')
  assert.match(englishHtml, /Skills: /)
  assert.doesNotMatch(englishHtml, /&nbsp;/)
})

test('translates known languages against the catalog when language is "fr", leaving a custom/unknown one as-is', () => {
  const markdown = createMarkdownRenderer({ language: 'fr' })
  const html = markdown.render('```monster\nname: Test\nlanguages: [Common, Draconic, Zorbaxian]\n```\n')
  assert.match(html, /Langues&nbsp;: <\/span>Commun, Draconique, Zorbaxian/)
})

test('leaves languages in English as-authored when language is "en" (already matches the catalog value)', () => {
  const html = renderMonster('name: Test\nlanguages: [Common, Draconic]')
  assert.match(html, /Languages: <\/span>Common, Draconic/)
})

test('reorders the French subtitle (type before size) and gender-agrees the alignment with the monster type', () => {
  const markdown = createMarkdownRenderer({ language: 'fr' })
  const feminineHtml = markdown.render('```monster\nname: Test\nsize: M\ntype: monstrosity\nalignment: CE\n```\n')
  assert.match(feminineHtml, /<div class="statblock-subtitle">Monstruosité de taille M, Chaotique Mauvaise<\/div>/)

  const masculineHtml = markdown.render('```monster\nname: Test2\nsize: M\ntype: undead\nalignment: CE\n```\n')
  assert.match(masculineHtml, /<div class="statblock-subtitle">Mort-vivant de taille M, Chaotique Mauvais<\/div>/)
})

test('gender-agrees "Non aligné" to "non alignée" for a feminine monster type in French', () => {
  const markdown = createMarkdownRenderer({ language: 'fr' })
  const html = markdown.render('```monster\nname: Test\ntype: monstrosity\nalignment: UU\n```\n')
  assert.match(html, /alignée/)
})

test('translates monster size to a French letter code, not the spelled-out word', () => {
  const markdown = createMarkdownRenderer({ language: 'fr' })
  const html = markdown.render('```monster\nname: Test\nsize: H\ntype: giant\n```\n')
  assert.match(html, /<div class="statblock-subtitle">Géant de taille TG<\/div>/)
})

test('a translation-overrides.json-style override renames a catalog key\'s word project-wide', () => {
  const markdown = createMarkdownRenderer({
    language: 'fr',
    overrides: { fr: { 'Skill.Perception': 'Vigilance' } },
  })
  const html = markdown.render('```monster\nname: Test\nskills: { perception: 5 }\n```\n')
  assert.match(html, /Compétences&nbsp;: <\/span>Vigilance \+5/)
})

test('adds a "lang-fr" class to .statblock when language is "fr" (theme CSS switches the floating SAVE header to JdS)', () => {
  const markdown = createMarkdownRenderer({ language: 'fr' })
  const html = markdown.render('```monster\nname: Test\n```\n')
  assert.match(html, /<div class="statblock lang-fr">/)
})

test('does not add "lang-fr" when language is "en" (the default)', () => {
  const html = renderMonster('name: Test')
  assert.doesNotMatch(html, /lang-fr/)
})

test('language accepts a getter re-read on every render, not resolved once', () => {
  let language = 'en'
  const markdown = createMarkdownRenderer({ language: () => language })
  const englishHtml = markdown.render('```monster\nname: Test\nskills: { perception: 5 }\n```\n')
  assert.match(englishHtml, /Skills: <\/span>Perception \+5/)
  language = 'fr'
  const frenchHtml = markdown.render('```monster\nname: Test\nskills: { perception: 5 }\n```\n')
  assert.match(frenchHtml, /Compétences&nbsp;: <\/span>Perception \+5/)
})
