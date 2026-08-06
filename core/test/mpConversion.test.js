const assert = require('node:assert/strict')
const { mkdir, mkdtemp, readdir, readFile, writeFile } = require('node:fs/promises')
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
  assert.ok(analysis.notices.some((notice) => notice.code === 'compendium-blocks-found'))
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

test('convertMpProject reshapes an inline Item block into MPX field vocabulary', async () => {
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
  const result = await convertMpProject(sourceDirectory, destinationDirectory)
  const page = await readFile(join(destinationDirectory, 'pages', 'page.md'), 'utf8')
  assert.match(page, /```item/)
  assert.match(page, /rarity: "common"/)
  assert.match(page, /type: "weapon"/)
  assert.match(page, /descr: "Objet de test\."/)
  assert.doesNotMatch(page, /description:/)
  assert.ok(result.notices.some((notice) => notice.code === 'compendium-blocks-converted'))
})

test('convertMpProject reshapes an inline Spell block, parsing free-text activation/duration', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  await writeFile(join(sourceDirectory, 'Module.yaml'), 'name: Test\nversion: "1.0"\n')
  await writeFile(
    join(sourceDirectory, 'page.md'),
    `---
name: Page
slug: page
order: 0
---

\`\`\`Spell
name: Rayon illustré
level: 2
school: Evocation
ritual: false
time: 1 action
range: 18
components: V, S
duration: Concentration, up to 1 minute
description: Un rayon de test.
classes: Magicien, Ensorceleur
\`\`\`
`,
  )
  await convertMpProject(sourceDirectory, destinationDirectory)
  const page = await readFile(join(destinationDirectory, 'pages', 'page.md'), 'utf8')
  assert.match(page, /```spell/)
  assert.match(page, /school: "evocation"/)
  assert.match(page, /time: 1/)
  assert.match(page, /unit: "action"/)
  assert.match(page, /components: \["V", "S"\]/)
  assert.match(page, /durationType: "concentration"/)
  assert.match(page, /duration: 1/)
  assert.match(page, /durationUnit: "minute"/)
  assert.match(page, /classes: \["Magicien", "Ensorceleur"\]/)
})

test('convertMpProject copies an inline Spell block\'s image into spells/ and rewrites its path', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  await writeFile(join(sourceDirectory, 'Module.yaml'), 'name: Test\nversion: "1.0"\n')
  await writeFile(
    join(sourceDirectory, 'page.md'),
    `---
name: Page
slug: page
order: 0
---

\`\`\`Spell
name: Rayon illustré
image: spell-cover.png
show-image: true
\`\`\`
`,
  )
  await writeFile(join(sourceDirectory, 'spell-cover.png'), 'spell image bytes')

  await convertMpProject(sourceDirectory, destinationDirectory)
  const page = await readFile(join(destinationDirectory, 'pages', 'page.md'), 'utf8')
  assert.match(page, /image: "spells\/spell-cover\.png"/)
  assert.match(page, /showImage: true/)
  assert.equal(
    await readFile(join(destinationDirectory, 'spells', 'spell-cover.png'), 'utf8'),
    'spell image bytes',
  )
})

test('convertMpProject reports a field notice for an unrecognized casting time/school/rarity', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  await writeFile(join(sourceDirectory, 'Module.yaml'), 'name: Test\nversion: "1.0"\n')
  await writeFile(
    join(sourceDirectory, 'page.md'),
    `---
name: Page
slug: page
order: 0
---

\`\`\`Spell
name: Weird Spell
school: Not A Real School
time: Special
\`\`\`
`,
  )
  const result = await convertMpProject(sourceDirectory, destinationDirectory)
  const fieldNotices = result.notices.filter((notice) => notice.code === 'compendium-field-notice')
  assert.ok(fieldNotices.some((notice) => notice.message.includes('field "school"')))
  assert.ok(fieldNotices.some((notice) => notice.message.includes('field "activation"')))
})

// The three blocks below are real MP-authored content (not test fixtures)
// supplied directly by the user, chosen because they exercise field shapes
// the original fixture-derived mappers didn't handle: array-form item
// properties, currency-text value, attunement-as-requirement-text,
// composite spell range text, and the full monster block (structured
// speed/saves/skills/senses, kebab-case feature lists, and an MP-only
// "mythic-actions" section with no MPX equivalent).
const REAL_MP_ITEM_SPELL_MONSTER_BLOCKS = `\`\`\`Item
name: Quarterstaff of Thwacking
slug: quarterstaff-of-thwacking
rarity: Uncommon
type: Weapon
attunement: Requires attunement by a monk
primaryDamage: 1d6
secondaryDamage: 1d8
properties:
  - Versatile
  - Finesse
damageType: Bludgeoning
description: This legendary quarterstaff has thwacked many a foe.
value: 1 gp
source: Example Module
image: QuaterstaffOfThwacking.jpg
show-image: false
\`\`\`

\`\`\`Spell
name: Dumpster Fire
slug: dumpster-fire
level: 0
school: Evocation
ritual: false
time: 1 action
range: Self (30-foot radius)
components: V
duration: Concentration, up to 1 minute
description: Ignites all nearby dumpsters.
classes: Sorcerer, Warlock, Wizard
image: DumpsterFire.jpg
show-image: false
source: Example Module
\`\`\`

\`\`\`Monster {.two-column}
id: 2c011c22-0f0c-4cc8-95de-9f53a9b89df5
name: Evil McEvilface
slug: evil-mcevilface
size: Medium
type: humanoid
alignment: neutral evil
ac: 15
hp: 30 (10d6)
speed: 30 ft.
str: 17
dex: 13
con: 12
int: 10
wis: 6
cha: 8
saves: Str + 2
skills: Stealth +6
vulnerabilities: radiant
resistances: bludgeoning, piercing
damageImmunities: poison
conditionImmunities: poisoned, petrified
senses: darkvision 60 ft., passive Perception 9
languages: Common, Celestial
challenge: 1/4
environments: forest, grassland, hill, underdark
image: Monster.jpg
token: MonsterToken.png
traits:
  - name: Smells Bad
    description: The Evil McEvilface smells pretty ripe. This doesn't do anything to the party, but makes unarmed combat and grappling far less pleasant.
actions:
  - name: Novelty-Sized Plunger
    description: "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d6 + 4) suction damage."
  - name: Open-carry Trebuchet
    description: "Ranged Weapon Attack: +5 to hit, range 80/320 ft., one target. Hit: 7 (1d6 + 4) bludgeon damage."
bonus-actions:
  - name: Silly Sidestep
    description: "The Evil McEvilface does a silly walk, sidesteps your blow, and takes half damage."
reactions:
  - name: Indignant Glare
    description: If the Evil McEvilface makes a successful spell saving throw, the Evil McEvilface glares at you disapprovingly and you feel shame. Your next ability check must be rolled with disadvantage.
legendary-actions:
  - description: The Evil McEvilface can take 1 legendary actions, using the Explosion option below.
  - name: Explosion
    description: "The Evil McEvilface suddenly explodes doing 1d20 damage to all creatures within 10 ft. This kills the Evil McEvilface."
mythic-actions:
  - description: If The Evil McEvilface's Smells Bad Trait has activated in the last hour, it can use the options below as legendary actions.
  - name: Bonk
    description: "The Evil McEvilface can bonk you."
description: Evil McEvilface lives in the sewer, but not in a cool way like a Ninja Turtle.
\`\`\`
`

test('convertMpProject reshapes a real MP Item block (array properties, currency value, attunement text)', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  await writeFile(join(sourceDirectory, 'Module.yaml'), 'name: Test\nversion: "1.0"\n')
  await writeFile(join(sourceDirectory, 'QuaterstaffOfThwacking.jpg'), 'fake-image')
  await writeFile(join(sourceDirectory, 'DumpsterFire.jpg'), 'fake-image')
  await writeFile(join(sourceDirectory, 'Monster.jpg'), 'fake-image')
  await writeFile(join(sourceDirectory, 'MonsterToken.png'), 'fake-token')
  await writeFile(join(sourceDirectory, 'page.md'), `---\nname: Page\nslug: page\norder: 0\n---\n\n${REAL_MP_ITEM_SPELL_MONSTER_BLOCKS}`)
  const result = await convertMpProject(sourceDirectory, destinationDirectory)
  const page = await readFile(join(destinationDirectory, 'pages', 'page.md'), 'utf8')

  assert.match(page, /```item/)
  assert.match(page, /type: "weapon"/)
  assert.match(page, /rarity: "uncommon"/)
  assert.match(page, /attunement: true/)
  assert.match(page, /attunementDetail: "Requires attunement by a monk"/)
  assert.match(page, /dmg1: "1d6"/)
  assert.match(page, /dmg2: "1d8"/)
  assert.match(page, /dmgType: "bludgeoning"/)
  assert.match(page, /properties: \["versatile", "finesse"\]/)
  assert.match(page, /value: 1\b/)
  assert.match(page, /sources:\n\s*- name: "Example Module"/)
  assert.match(page, /image: "items\/QuaterstaffOfThwacking\.jpg"/)

  const fieldNotices = result.notices.filter((notice) => notice.code === 'compendium-field-notice')
  assert.equal(fieldNotices.length, 0)
})

test('convertMpProject reshapes a real MP Spell block (composite "Self (30-foot radius)" range)', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  await writeFile(join(sourceDirectory, 'Module.yaml'), 'name: Test\nversion: "1.0"\n')
  await writeFile(join(sourceDirectory, 'DumpsterFire.jpg'), 'fake-image')
  await writeFile(join(sourceDirectory, 'QuaterstaffOfThwacking.jpg'), 'fake-image')
  await writeFile(join(sourceDirectory, 'page.md'), `---\nname: Page\nslug: page\norder: 0\n---\n\n${REAL_MP_ITEM_SPELL_MONSTER_BLOCKS}`)
  const result = await convertMpProject(sourceDirectory, destinationDirectory)
  const page = await readFile(join(destinationDirectory, 'pages', 'page.md'), 'utf8')

  assert.match(page, /```spell/)
  assert.match(page, /rangeType: "self"/)
  assert.match(page, /areaEffectShape: "sphere"/)
  assert.match(page, /areaEffectSize: 30/)
  assert.match(page, /durationType: "concentration"/)
  assert.match(page, /duration: 1/)
  assert.match(page, /durationUnit: "minute"/)
  assert.match(page, /classes: \["Sorcerer", "Warlock", "Wizard"\]/)

  const fieldNotices = result.notices.filter(
    (notice) => notice.code === 'compendium-field-notice' && notice.message.includes('Dumpster Fire'),
  )
  assert.equal(fieldNotices.length, 0)
})

test('convertMpProject reshapes a real MP Monster block (structured speed/saves/skills/senses, feature lists, mythic-actions folded into descr)', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  await writeFile(join(sourceDirectory, 'Module.yaml'), 'name: Test\nversion: "1.0"\n')
  await writeFile(join(sourceDirectory, 'Monster.jpg'), 'fake-image')
  await writeFile(join(sourceDirectory, 'MonsterToken.png'), 'fake-token')
  await writeFile(join(sourceDirectory, 'DumpsterFire.jpg'), 'fake-image')
  await writeFile(join(sourceDirectory, 'QuaterstaffOfThwacking.jpg'), 'fake-image')
  await writeFile(join(sourceDirectory, 'page.md'), `---\nname: Page\nslug: page\norder: 0\n---\n\n${REAL_MP_ITEM_SPELL_MONSTER_BLOCKS}`)
  const result = await convertMpProject(sourceDirectory, destinationDirectory)
  const page = await readFile(join(destinationDirectory, 'pages', 'page.md'), 'utf8')

  assert.match(page, /```monster \{\.two-column\}/)
  assert.match(page, /id: "2c011c22-0f0c-4cc8-95de-9f53a9b89df5"/)
  assert.match(page, /size: "M"/)
  assert.match(page, /alignment: "NE"/)
  assert.match(page, /ac: "15"/)
  assert.match(page, /hp: "30 \(10d6\)"/)
  assert.match(page, /speed:\n\s*walk: 30/)
  assert.match(page, /abilities: \{ str: 17, dex: 13, con: 12, int: 10, wis: 6, cha: 8 \}/)
  assert.match(page, /savingThrows: \{ str: 2 \}/)
  assert.match(page, /skills: \{ stealth: 6 \}/)
  assert.match(page, /damageVulnerabilities: \["radiant"\]/)
  assert.match(page, /damageResistances: \["bludgeoning", "piercing"\]/)
  assert.match(page, /damageImmunities: \["poison"\]/)
  assert.match(page, /conditionImmunities: \["poisoned", "petrified"\]/)
  assert.match(page, /senses:\n\s*darkvision: 60/)
  assert.match(page, /passivePerception: 9/)
  assert.match(page, /languages: \["Common", "Celestial"\]/)
  assert.match(page, /cr: "1\/4"/)
  assert.match(page, /environments: \["forest", "grassland", "hill", "underdark"\]/)
  assert.match(page, /bonusActions:/)
  assert.match(page, /legendaryActions:/)
  assert.match(page, /image: "monsters\/Monster\.jpg"/)
  assert.match(page, /token: "monsters\/MonsterToken\.png"/)

  // "mythic-actions" has no MPX field — the "never drop MP data" rule folds
  // it into descr rather than losing it.
  assert.match(page, /Mythic Actions \(not a supported MPX section\)/)
  assert.match(page, /Bonk/)

  const fieldNotices = result.notices.filter(
    (notice) => notice.code === 'compendium-field-notice' && notice.message.includes('Evil McEvilface'),
  )
  assert.equal(fieldNotices.length, 0)
})

test('analyzeMpProject reads MP map/encounter archive references from Module.yaml', async () => {
  const { sourceDirectory } = await makeTempDirs()
  await writeFile(
    join(sourceDirectory, 'Module.yaml'),
    `name: Test
version: "1.0"
maps:
  - path: Maps/my-first-map.zip
    order: 2
    parent: my-adventure-part-1
    slug: my-first-map
encounters:
  - path: Encounters/my-first-encounter.zip
    order: 1
    parent: my-first-map
    slug: my-first-encounter
`,
  )

  const analysis = await analyzeMpProject(sourceDirectory)
  assert.equal(analysis.archives.length, 2)
  const map = analysis.archives.find((archive) => archive.kind === 'map')
  assert.equal(map.slug, 'my-first-map')
  assert.equal(map.sourcePath, 'Maps/my-first-map.zip')
  assert.equal(map.rank, 2)
  // "my-adventure-part-1" isn't a real page/group/archive slug in this
  // fixture — same "unknown parent" handling as a page's own parent.
  assert.equal(map.parentSlug, undefined)
  const encounter = analysis.archives.find((archive) => archive.kind === 'encounter')
  assert.equal(encounter.parentSlug, 'my-first-map')
  assert.ok(analysis.notices.some((notice) => notice.code === 'archives-found'))
  assert.ok(analysis.notices.some((notice) => notice.code === 'unknown-parent' && notice.path === 'Maps/my-first-map.zip'))
})

test('convertMpProject copies a MP map/encounter .zip as-is and writes its MPX JSON reference', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  await mkdir(join(sourceDirectory, 'Maps'), { recursive: true })
  await mkdir(join(sourceDirectory, 'Encounters'), { recursive: true })
  await writeFile(join(sourceDirectory, 'Maps', 'my-first-map.zip'), 'fake-map-zip-content')
  await writeFile(join(sourceDirectory, 'Encounters', 'my-first-encounter.zip'), 'fake-encounter-zip-content')
  await writeFile(
    join(sourceDirectory, 'Module.yaml'),
    `name: Test
version: "1.0"
maps:
  - path: Maps/my-first-map.zip
    order: 2
    slug: my-first-map
encounters:
  - path: Encounters/my-first-encounter.zip
    order: 1
    parent: my-first-map
    slug: my-first-encounter
`,
  )

  const result = await convertMpProject(sourceDirectory, destinationDirectory)

  const mapZip = await readFile(join(destinationDirectory, 'maps', 'my-first-map.zip'), 'utf8')
  assert.equal(mapZip, 'fake-map-zip-content')
  const mapJson = JSON.parse(await readFile(join(destinationDirectory, 'maps', 'my-first-map.json'), 'utf8'))
  assert.equal(mapJson.slug, 'my-first-map')
  assert.equal(mapJson.name, 'My First Map')
  assert.equal(mapJson.rank, 2)
  assert.equal(mapJson.parent, '')
  assert.equal(mapJson.path, 'maps/my-first-map.zip')

  const encounterZip = await readFile(join(destinationDirectory, 'encounters', 'my-first-encounter.zip'), 'utf8')
  assert.equal(encounterZip, 'fake-encounter-zip-content')
  const encounterJson = JSON.parse(await readFile(join(destinationDirectory, 'encounters', 'my-first-encounter.json'), 'utf8'))
  assert.equal(encounterJson.parent, 'my-first-map')

  assert.ok(result.notices.some((notice) => notice.code === 'archives-converted'))
  assert.ok(!result.notices.some((notice) => notice.code === 'archives-found'))
})

/** Builds a real EncounterPlus map/encounter export zip, matching the
 * format buildModule itself reads: a single-object manifest plus optional
 * resources — this is what a .zip re-exported from a current EncounterPlus
 * looks like, as opposed to MP's own older XML export format. */
async function writeExportArchive(destPath, manifestFileName, record) {
  const { ZipFile } = require('yazl')
  await new Promise((resolvePromise, rejectPromise) => {
    const zip = new ZipFile()
    zip.addBuffer(Buffer.from(JSON.stringify([record])), manifestFileName)
    zip.outputStream.pipe(require('node:fs').createWriteStream(destPath)).on('close', resolvePromise).on('error', rejectPromise)
    zip.end()
  })
}

test('convertMpProject reads the real name/descr from a MP map .zip already in EncounterPlus\'s V5 export format', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  await mkdir(join(sourceDirectory, 'Maps'), { recursive: true })
  await writeExportArchive(join(sourceDirectory, 'Maps', 'my-map.zip'), 'maps.json', {
    name: 'Le Temple',
    slug: 'carte-temple',
    descr: 'Une carte du temple.',
  })
  await writeFile(
    join(sourceDirectory, 'Module.yaml'),
    `name: Test
version: "1.0"
maps:
  - path: Maps/my-map.zip
    slug: my-map
`,
  )

  const result = await convertMpProject(sourceDirectory, destinationDirectory)
  const mapJson = JSON.parse(await readFile(join(destinationDirectory, 'maps', 'my-map.json'), 'utf8'))
  assert.equal(mapJson.name, 'Le Temple')
  assert.equal(mapJson.descr, 'Une carte du temple.')
  assert.equal(mapJson.slug, 'my-map')

  const archivesConverted = result.notices.find((notice) => notice.code === 'archives-converted')
  assert.ok(archivesConverted)
  assert.doesNotMatch(archivesConverted.message, /re-export/)
})

test('convertMpProject reports a missing-archive notice when a MP map/encounter .zip cannot be found', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  await writeFile(
    join(sourceDirectory, 'Module.yaml'),
    `name: Test
version: "1.0"
maps:
  - path: Maps/does-not-exist.zip
    slug: does-not-exist
`,
  )

  const result = await convertMpProject(sourceDirectory, destinationDirectory)
  assert.ok(result.notices.some((notice) => notice.code === 'missing-archive'))
})

test('convertMpProject rebuilds a missing map .zip from a leftover root maps.json', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  // Module.yaml references a .zip that was never actually placed in Maps/
  // (e.g. a community module whose author stripped the raw exports before
  // sharing it) — but a maps.json is still sitting at the project root, a
  // residual build artifact MP itself writes next to Module.yaml, and it
  // has this exact map's own data plus its resource file names.
  await writeFile(join(sourceDirectory, 'floor.png'), 'fake-floor-image')
  await writeFile(join(sourceDirectory, 'illustration.webp'), 'fake-illustration')
  await writeFile(
    join(sourceDirectory, 'maps.json'),
    JSON.stringify([
      {
        id: '4c2f3208-a9df-5123-bee9-0caa688e832c',
        name: 'Le Temple',
        slug: 'carte-temple',
        descr: 'Une carte du temple.',
        image: 'illustration.webp',
        floor: 'floor.png',
        tiles: [{ asset: { resource: 'floor.png' } }],
      },
    ]),
  )
  await writeFile(
    join(sourceDirectory, 'Module.yaml'),
    `name: Test
version: "1.0"
maps:
  - path: Cartes/carte-temple.zip
    slug: carte-temple
`,
  )

  const result = await convertMpProject(sourceDirectory, destinationDirectory)
  assert.ok(!result.notices.some((notice) => notice.code === 'missing-archive'))

  const mapJson = JSON.parse(await readFile(join(destinationDirectory, 'maps', 'carte-temple.json'), 'utf8'))
  assert.equal(mapJson.name, 'Le Temple')
  assert.equal(mapJson.descr, 'Une carte du temple.')

  const { readExportArchive } = require('../dist/mapEncounterExport.js')
  const rebuilt = await readExportArchive(join(destinationDirectory, 'maps', 'carte-temple.zip'), 'maps.json')
  assert.equal(rebuilt.record.name, 'Le Temple')
  assert.ok(rebuilt.resources.has('floor.png'))
  assert.ok(rebuilt.resources.has('illustration.webp'))

  const archivesConverted = result.notices.find((notice) => notice.code === 'archives-converted')
  assert.match(archivesConverted.message, /rebuilt from a leftover root maps\.json/)
})

test('convertMpProject renames a reconstructed archive\'s resource only when it actually collides with another reconstructed map', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  // Both maps reference the same shared tile ("P.png", a reused "trap"
  // asset) — a real EncounterPlus export would never collide (each export
  // gets its own unique file names), but reconstructing straight from the
  // root maps.json's plain file names would, since buildModule merges every
  // maps/*.zip's resources into one flat namespace.
  await writeFile(join(sourceDirectory, 'P.png'), 'fake-shared-tile')
  await writeFile(
    join(sourceDirectory, 'maps.json'),
    JSON.stringify([
      { id: '11111111-1111-1111-1111-111111111111', name: 'Map A', slug: 'map-a', floor: 'P.png' },
      { id: '22222222-2222-2222-2222-222222222222', name: 'Map B', slug: 'map-b', floor: 'P.png' },
    ]),
  )
  await writeFile(
    join(sourceDirectory, 'Module.yaml'),
    `name: Test
version: "1.0"
maps:
  - path: Cartes/map-a.zip
    slug: map-a
  - path: Cartes/map-b.zip
    slug: map-b
`,
  )

  await convertMpProject(sourceDirectory, destinationDirectory)

  const { readExportArchive } = require('../dist/mapEncounterExport.js')
  const mapA = await readExportArchive(join(destinationDirectory, 'maps', 'map-a.zip'), 'maps.json')
  const mapB = await readExportArchive(join(destinationDirectory, 'maps', 'map-b.zip'), 'maps.json')

  // First one claims the plain name; the second is renamed, and its own
  // manifest's floor field is kept in sync with the renamed file.
  assert.ok(mapA.resources.has('P.png'))
  assert.equal(mapA.record.floor, 'P.png')
  assert.ok(mapB.resources.has('map-b-P.png'))
  assert.equal(mapB.record.floor, 'map-b-P.png')
  assert.ok(!mapB.resources.has('P.png'))

  const { buildModule } = require('../dist/index.js')
  const summary = await buildModule(destinationDirectory)
  assert.equal(summary.mapCount, 2)
})

test('convertMpProject does not treat a tile\'s free-text asset.name as a second resource distinct from its own asset.resource', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  // A real MP/EncounterPlus tile carries both a free-text display `name`
  // ("arrow white.png", lowercase, not a real path) and the actual file
  // name in `resource` ("Arrow white.png") — differing only in case. Before
  // this fix, both were treated as resource file names, so the rebuilt
  // .zip ended up with two entries that collide once extracted on a
  // case-insensitive filesystem (macOS/Windows).
  await writeFile(join(sourceDirectory, 'Arrow white.png'), 'fake-tile-image')
  await writeFile(
    join(sourceDirectory, 'maps.json'),
    JSON.stringify([
      {
        id: '33333333-3333-3333-3333-333333333333',
        name: 'Map C',
        slug: 'map-c',
        tiles: [{ asset: { name: 'arrow white.png', resource: 'Arrow white.png' } }],
      },
    ]),
  )
  await writeFile(
    join(sourceDirectory, 'Module.yaml'),
    `name: Test
version: "1.0"
maps:
  - path: Cartes/map-c.zip
    slug: map-c
`,
  )

  await convertMpProject(sourceDirectory, destinationDirectory)

  const { readExportArchive } = require('../dist/mapEncounterExport.js')
  const mapC = await readExportArchive(join(destinationDirectory, 'maps', 'map-c.zip'), 'maps.json')
  assert.deepEqual([...mapC.resources.keys()], ['Arrow white.png'])
})

test('convertMpProject detects French from Module.yaml\'s description and sets mpx.contentLanguage', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  await writeFile(
    join(sourceDirectory, 'Module.yaml'),
    'name: Test\nversion: "1.0"\ndescription: Une description en français avec des accents éèà pour tester la détection.\n',
  )
  await convertMpProject(sourceDirectory, destinationDirectory)
  const settings = JSON.parse(await readFile(join(destinationDirectory, '.vscode', 'settings.json'), 'utf8'))
  assert.equal(settings['mpx.contentLanguage'], 'fr')
})

test('convertMpProject reflects Module.yaml\'s create-roll-tables value in mpx.autoDetectRollTables', async () => {
  const { destinationDirectory: destA, sourceDirectory: sourceA } = await makeTempDirs()
  await writeFile(join(sourceA, 'Module.yaml'), 'name: Test\nversion: "1.0"\ncreate-roll-tables: false\n')
  await convertMpProject(sourceA, destA)
  const settingsA = JSON.parse(await readFile(join(destA, '.vscode', 'settings.json'), 'utf8'))
  assert.equal(settingsA['mpx.autoDetectRollTables'], false)

  const { destinationDirectory: destB, sourceDirectory: sourceB } = await makeTempDirs()
  await writeFile(join(sourceB, 'Module.yaml'), 'name: Test\nversion: "1.0"\ncreate-roll-tables: true\n')
  await convertMpProject(sourceB, destB)
  const settingsB = JSON.parse(await readFile(join(destB, '.vscode', 'settings.json'), 'utf8'))
  assert.equal(settingsB['mpx.autoDetectRollTables'], true)

  const { destinationDirectory: destC, sourceDirectory: sourceC } = await makeTempDirs()
  await writeFile(join(sourceC, 'Module.yaml'), 'name: Test\nversion: "1.0"\n')
  await convertMpProject(sourceC, destC)
  const settingsC = JSON.parse(await readFile(join(destC, '.vscode', 'settings.json'), 'utf8'))
  assert.equal(settingsC['mpx.autoDetectRollTables'], true)
})

test('convertMpProject does not create a group for a plain subfolder with no Group.yaml', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  await writeFile(join(sourceDirectory, 'Module.yaml'), 'name: Test\nversion: "1.0"\n')
  await mkdir(join(sourceDirectory, 'resources', 'items'), { recursive: true })
  await mkdir(join(sourceDirectory, 'resources', 'monsters'), { recursive: true })
  await writeFile(join(sourceDirectory, 'resources', 'items', 'sword.png'), 'fake-image')
  await writeFile(join(sourceDirectory, 'page.md'), '---\nname: Page\nslug: page\norder: 0\n---\n\nText.\n')

  const result = await convertMpProject(sourceDirectory, destinationDirectory)
  assert.equal(result.groupCount, 0)
  const groupsExist = await readdir(destinationDirectory).catch(() => [])
  assert.ok(!groupsExist.includes('groups'))
})

test('convertMpProject still creates a group for a subfolder that does declare a Group.yaml', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  await writeFile(join(sourceDirectory, 'Module.yaml'), 'name: Test\nversion: "1.0"\n')
  await mkdir(join(sourceDirectory, 'Chapter 1'), { recursive: true })
  await writeFile(join(sourceDirectory, 'Chapter 1', 'Group.yaml'), 'name: Chapter One\n')
  await writeFile(join(sourceDirectory, 'Chapter 1', 'page.md'), '---\nname: Page\nslug: page\norder: 0\n---\n\nText.\n')

  const result = await convertMpProject(sourceDirectory, destinationDirectory)
  assert.equal(result.groupCount, 1)
  const groupFiles = await readdir(join(destinationDirectory, 'groups'))
  assert.deepEqual(groupFiles, ['group-chapter-one.json'])
})

test('convertMpProject splits a glued {.class} blockquote decoration onto its own line', async () => {
  const { destinationDirectory, sourceDirectory } = await makeTempDirs()
  await writeFile(join(sourceDirectory, 'Module.yaml'), 'name: Test\nversion: "1.0"\n')
  await writeFile(
    join(sourceDirectory, 'page.md'),
    `---
name: Page
slug: page
order: 0
---

>Some flavor text ending the quote.{.read}

>**Cartes :**
>- [**Room**](room)
{.purple .color-links}
`,
  )
  await convertMpProject(sourceDirectory, destinationDirectory)
  const page = await readFile(join(destinationDirectory, 'pages', 'page.md'), 'utf8')
  assert.match(page, /Some flavor text ending the quote\.\n\{\.read\}/)
  assert.match(page, /\[\*\*Room\*\*\]\(room\)\n\{\.purple \.color-links\}/)
})
