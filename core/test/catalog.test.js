const assert = require('node:assert/strict')
const test = require('node:test')

const { translate, pluralize } = require('../dist/index.js')

test('translate falls back to the key itself when unknown, for either language', () => {
  assert.equal(translate('Nonsense.Key', 'en'), 'Nonsense.Key')
  assert.equal(translate('Nonsense.Key', 'fr'), 'Nonsense.Key')
})

test('translate resolves the English catalog by default', () => {
  assert.equal(translate('Common.Source', 'en'), 'Source')
  assert.equal(translate('Skill.Perception', 'en'), 'Perception')
})

test('translate resolves the French catalog, including the container-capacity key fix', () => {
  assert.equal(translate('Common.Source', 'fr'), 'Source')
  assert.equal(translate('Skill.Perception', 'fr'), 'Perception')
  assert.equal(translate('Ability.STR', 'fr'), 'FOR')
  assert.equal(translate('Item.ContainerCapacity', 'fr'), 'Capacité du récipient (kg)')
})

test('translate leaves EncounterPlus\'s own untranslated French placeholders as-is', () => {
  assert.equal(translate('Vehicle.KeelBeam', 'fr'), 'Keel Beam (à traduire)')
})

test('pluralize picks "one" or "many" from a {one, many} catalog entry', () => {
  assert.equal(pluralize('Unit.Hour', 1, 'en'), 'Hour')
  assert.equal(pluralize('Unit.Hour', 2, 'en'), 'Hours')
  assert.equal(pluralize('Unit.Hour', 1, 'fr'), 'Heure')
  assert.equal(pluralize('Unit.Hour', 2, 'fr'), 'Heures')
})

test('an override replaces the displayed word for a catalog key, in the language it targets only', () => {
  const overrides = { fr: { 'Skill.Perception': 'Vigilance' } }
  assert.equal(translate('Skill.Perception', 'fr', overrides), 'Vigilance')
  assert.equal(translate('Skill.Perception', 'en', overrides), 'Perception')
})

test('an override on a pluralized key replaces the whole entry, including its plural form', () => {
  const overrides = { en: { 'Unit.Hour': { one: 'Turn', many: 'Turns' } } }
  assert.equal(pluralize('Unit.Hour', 1, 'en', overrides), 'Turn')
  assert.equal(pluralize('Unit.Hour', 2, 'en', overrides), 'Turns')
})

test('an override for an unknown key still applies (lets a project add a label with no upstream equivalent)', () => {
  const overrides = { en: { 'Custom.Key': 'Custom Value' } }
  assert.equal(translate('Custom.Key', 'en', overrides), 'Custom Value')
})
