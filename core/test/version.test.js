const assert = require('node:assert/strict')
const test = require('node:test')

const { incrementPatchVersion } = require('../dist/index.js')

test('incrementPatchVersion bumps the patch number', () => {
  assert.equal(incrementPatchVersion('1.0.0'), '1.0.1')
  assert.equal(incrementPatchVersion('2.4.9'), '2.4.10')
})

test('incrementPatchVersion leaves a non-semver string unchanged', () => {
  assert.equal(incrementPatchVersion('not-a-version'), 'not-a-version')
  assert.equal(incrementPatchVersion('1.0'), '1.0')
})
