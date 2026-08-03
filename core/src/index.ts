export { createModuleProject, detectWorkspaceKind, MODULE_CATEGORIES } from './moduleProject.js'
export type { ModuleCategory, ModuleJson, WorkspaceKind } from './moduleProject.js'
export { parseModuleTree } from './moduleTree.js'
export type { ModuleTreeNode, ModuleTreeNodeKind } from './moduleTree.js'
export {
  createPage,
  createGroup,
  createMapReference,
  createEncounterReference,
} from './contentEntries.js'
export type { ContentEntryKind, CreatedContentEntry } from './contentEntries.js'
export { createItem, createSpell, createRollTable, createMonster, COMPENDIUM_RULESET } from './compendiumEntries.js'
export { buildModule, ModuleBuildError } from './buildModule.js'
export type { BuildIssue, BuildOptions, BuildSummary } from './buildModule.js'
export { incrementPatchVersion } from './version.js'
export {
  resolveMeasurementSystem,
  normalizeContentLanguage,
  normalizeDefaultMeasurement,
  DEFAULT_CONTENT_LANGUAGE,
  DEFAULT_MEASUREMENT,
} from './localization.js'
export type { ContentLanguage, DefaultMeasurement, MeasurementSystem } from './localization.js'
export { translate, pluralize } from './catalog.js'
export type { CatalogOverrides, RenderLocale } from './catalog.js'
export { loadCatalogOverrides, parseCatalogOverrides, TRANSLATION_OVERRIDES_FILENAME } from './catalogOverrides.js'
export { createMarkdownRenderer } from './markdownRenderer.js'
export type {
  MarkdownRendererOptions,
  MpxMarkdownEnvironment,
  InlineSpellBlock,
  InlineItemBlock,
  InlineMonsterBlock,
} from './markdownRenderer.js'
export type { SpellDisplayDefaults } from './spellBlock.js'
export type { ItemDisplayDefaults } from './itemBlock.js'
export type { MonsterDisplayDefaults } from './monsterBlock.js'
export { findInlineSpells } from './inlineSpellScan.js'
export type { InlineSpellSummary } from './inlineSpellScan.js'
export { findInlineItems } from './inlineItemScan.js'
export type { InlineItemSummary } from './inlineItemScan.js'
export { findInlineMonsters } from './inlineMonsterScan.js'
export type { InlineMonsterSummary } from './inlineMonsterScan.js'

// Inline ```spell/item/monster block editing assistance (completion +
// diagnostics, see extension/src/compendiumBlockAssistance.ts): parsers,
// field-name lists, and enum value lists, all reused as-is from the
// renderer/validator so the editor never drifts from what actually builds.
export { parseSpellBlock, SPELL_META_FIELDS, SPELL_DATA_FIELDS } from './spellBlock.js'
export type { ParsedSpellBlock } from './spellBlock.js'
export { parseItemBlock, ITEM_META_FIELDS, ITEM_DATA_FIELDS } from './itemBlock.js'
export type { ParsedItemBlock } from './itemBlock.js'
export { parseMonsterBlock, MONSTER_META_FIELDS, MONSTER_DATA_FIELDS } from './monsterBlock.js'
export type { ParsedMonsterBlock } from './monsterBlock.js'
export {
  SPELL_SCHOOLS,
  SPELL_RANGE_TYPES,
  SPELL_AREA_EFFECT_SHAPES,
  SPELL_COMPONENTS,
  SPELL_DURATION_TYPES,
  SPELL_DURATION_UNITS,
} from './spellCompendium.js'
export { ITEM_TYPES, ITEM_RARITIES, ITEM_PROPERTIES, ITEM_MASTERIES, ITEM_DAMAGE_TYPES } from './itemCompendium.js'
export {
  MONSTER_SIZES,
  MONSTER_TYPES,
  MONSTER_ALIGNMENTS,
  MONSTER_DAMAGE_TYPES,
  MONSTER_CHALLENGE_RATINGS,
} from './monsterCompendium.js'
export type { ValidationIssue } from './compendiumShared.js'
