/** Manifest filename → project folder, for every Compendium content type
 * MPX currently accepts as a raw EncounterPlus export (no YAML authoring,
 * see readRuleImports in buildModule.ts). Extending raw import to another
 * content type is just adding an entry here, plus its own build-side
 * merge — see AUTHORED_COMPENDIUM_MANIFESTS below for the ones that
 * deliberately aren't (yet). */
export const RAW_COMPENDIUM_IMPORT_TYPES: Record<string, { folder: string; label: string }> = {
  'rules.json': { folder: 'rules', label: 'Rule' },
}

/** Manifest filename → content type label, for every type MPX already has
 * full YAML/schema authoring for ("Create X" + optional inline block).
 * The generic Import Compendium command refuses a zip matching one of
 * these rather than silently merging unvalidated raw entries alongside
 * authored ones — see issue #43 for reconsidering this later. */
export const AUTHORED_COMPENDIUM_MANIFESTS: Record<string, string> = {
  'items.json': 'Item',
  'spells.json': 'Spell',
  'monsters.json': 'Monster',
  'backgrounds.json': 'Background',
  'tables.json': 'Roll Table',
}
