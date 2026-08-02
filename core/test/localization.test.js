const assert = require('node:assert/strict')
const test = require('node:test')

const { resolveMeasurementSystem, normalizeContentLanguage, normalizeDefaultMeasurement } = require('../dist/index.js')

test('normalizeContentLanguage accepts "fr" and defaults everything else to "en"', () => {
  assert.equal(normalizeContentLanguage('fr'), 'fr')
  assert.equal(normalizeContentLanguage('en'), 'en')
  assert.equal(normalizeContentLanguage('de'), 'en')
  assert.equal(normalizeContentLanguage(undefined), 'en')
})

test('normalizeDefaultMeasurement accepts imperial/metric and defaults everything else to "auto"', () => {
  assert.equal(normalizeDefaultMeasurement('imperial'), 'imperial')
  assert.equal(normalizeDefaultMeasurement('metric'), 'metric')
  assert.equal(normalizeDefaultMeasurement('auto'), 'auto')
  assert.equal(normalizeDefaultMeasurement('nonsense'), 'auto')
  assert.equal(normalizeDefaultMeasurement(undefined), 'auto')
})

test('resolveMeasurementSystem falls back to metric for French when "auto"', () => {
  assert.equal(resolveMeasurementSystem('auto', 'fr'), 'metric')
})

test('resolveMeasurementSystem falls back to imperial for English (or anything else) when "auto"', () => {
  assert.equal(resolveMeasurementSystem('auto', 'en'), 'imperial')
  assert.equal(resolveMeasurementSystem(undefined, undefined), 'imperial')
})

test('resolveMeasurementSystem lets an explicit choice win over the language fallback', () => {
  assert.equal(resolveMeasurementSystem('imperial', 'fr'), 'imperial')
  assert.equal(resolveMeasurementSystem('metric', 'en'), 'metric')
})
