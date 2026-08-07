import * as vscode from 'vscode'
import {
  parseSpellBlock,
  SPELL_META_FIELDS,
  SPELL_DATA_FIELDS,
  parseItemBlock,
  ITEM_META_FIELDS,
  ITEM_DATA_FIELDS,
  parseMonsterBlock,
  MONSTER_META_FIELDS,
  MONSTER_DATA_FIELDS,
  parseBackgroundBlock,
  BACKGROUND_META_FIELDS,
  BACKGROUND_DATA_FIELDS,
  SPELL_SCHOOLS,
  SPELL_ACTIVATION_UNITS,
  SPELL_RANGE_TYPES,
  SPELL_AREA_EFFECT_SHAPES,
  SPELL_COMPONENTS,
  SPELL_DURATION_TYPES,
  SPELL_DURATION_UNITS,
  ITEM_TYPES,
  ITEM_RARITIES,
  ITEM_PROPERTIES,
  ITEM_MASTERIES,
  ITEM_DAMAGE_TYPES,
  MONSTER_SIZES,
  MONSTER_TYPES,
  MONSTER_ALIGNMENTS,
  MONSTER_DAMAGE_TYPES,
  MONSTER_CHALLENGE_RATINGS,
  MONSTER_ABILITY_KEYS,
  MONSTER_SKILLS,
  MONSTER_LANGUAGES,
  MONSTER_ENVIRONMENTS,
  BACKGROUND_ABILITY_KEYS,
  BACKGROUND_SKILLS,
  COMPENDIUM_RULESET,
} from 'mpx-core'

type BlockKind = 'spell' | 'item' | 'monster' | 'background'

interface BlockRegion {
  kind: BlockKind
  /** 0-based, first line of YAML content (the line right after the opening fence). */
  contentStartLine: number
  /** 0-based, exclusive — the closing fence's own line, or document.lineCount if never closed. */
  contentEndLine: number
}

function withoutBlank(values: readonly string[]): string[] {
  return values.filter((value) => value !== '')
}

/** Every valid top-level YAML key for each inline block type — same lists
 * `normalizeInlineSpell`/`normalizeInlineItem`/`normalizeInlineMonster` use
 * to reshape flat authoring YAML into the { name, data, ... } shape the
 * validators expect, reused as-is so this never drifts from what the
 * renderer/build actually accepts. */
const FIELD_NAMES: Record<BlockKind, readonly string[]> = {
  spell: [...SPELL_META_FIELDS, ...SPELL_DATA_FIELDS],
  item: [...ITEM_META_FIELDS, ...ITEM_DATA_FIELDS],
  monster: [...MONSTER_META_FIELDS, ...MONSTER_DATA_FIELDS],
  background: [...BACKGROUND_META_FIELDS, ...BACKGROUND_DATA_FIELDS],
}

/** Enum-valued top-level scalar/array fields. Nested object fields
 * (`attributes`, a spell's `activation`, a monster's `abilities`/
 * `savingThrows`/`skills`) have their own children lists below
 * (CONTAINER_FIELDS) — a monster's `speed`/`senses` aren't covered yet.
 * Array fields (e.g. `components`, `damageResistances`) are listed the
 * same way as scalar ones: authored inline as `field: [a, b]` in every
 * existing snippet/example, so completing "after the colon" already
 * covers both. */
const ENUM_VALUES: Record<BlockKind, Record<string, readonly string[]>> = {
  spell: {
    school: withoutBlank(SPELL_SCHOOLS),
    rangeType: withoutBlank(SPELL_RANGE_TYPES),
    areaEffectShape: withoutBlank(SPELL_AREA_EFFECT_SHAPES),
    components: SPELL_COMPONENTS,
    durationType: withoutBlank(SPELL_DURATION_TYPES),
    durationUnit: withoutBlank(SPELL_DURATION_UNITS),
  },
  item: {
    type: withoutBlank(ITEM_TYPES),
    rarity: withoutBlank(ITEM_RARITIES),
    properties: withoutBlank(ITEM_PROPERTIES),
    mastery: withoutBlank(ITEM_MASTERIES),
    dmgType: withoutBlank(ITEM_DAMAGE_TYPES),
  },
  monster: {
    size: withoutBlank(MONSTER_SIZES),
    type: withoutBlank(MONSTER_TYPES),
    alignment: withoutBlank(MONSTER_ALIGNMENTS),
    damageImmunities: MONSTER_DAMAGE_TYPES,
    damageResistances: MONSTER_DAMAGE_TYPES,
    damageVulnerabilities: MONSTER_DAMAGE_TYPES,
    cr: withoutBlank(MONSTER_CHALLENGE_RATINGS),
    // Suggestions only, not a closed enum: EncounterPlus's own real data
    // model (confirmed by the user against its internal types.json) backs
    // both with a standard list but always allows a custom value alongside
    // it (a homebrew language, a setting-specific environment).
    languages: MONSTER_LANGUAGES,
    environments: MONSTER_ENVIRONMENTS,
  },
  background: {
    // Suggestions only, not a closed enum — same "custom value alongside
    // the standard list" convention as monster's languages/environments
    // above (see backgroundCompendium.ts). No entry for `tools`: it has no
    // standard list at all, purely free text.
    abilities: BACKGROUND_ABILITY_KEYS,
    skills: BACKGROUND_SKILLS,
  },
}

/** Object-valued fields with a known, fixed set of children — completion
 * inside one of these only offers its own children, not the block's
 * top-level fields (or, worse, nothing useful at all — the previous gap
 * this closes). A monster's `speed`/`senses` aren't covered yet. */
const ATTRIBUTES_CHILDREN: Record<string, readonly string[]> = {
  // Only ever holds a resolved "imperial"/"metric" once written (never
  // "auto" — that's a project *setting*'s own option, not a legal value for
  // an individual entry, see resolveMeasurementSystem in core).
  measurement: ['imperial', 'metric'],
  ruleset: [COMPENDIUM_RULESET],
}
/** Each ability key (`str`/`dex`/.../`cha`) maps to a plain number, so
 * there's nothing to suggest for the *value* — only the key names
 * themselves are worth completing. Shared by `abilities` and
 * `savingThrows` (both keyed the same way). */
const ABILITY_CHILDREN: Record<string, readonly string[]> = Object.fromEntries(
  MONSTER_ABILITY_KEYS.map((key) => [key, []]),
)
/** Same idea for `skills` — each skill name (`perception`, `stealth`, ...)
 * maps to a plain number. */
const SKILL_CHILDREN: Record<string, readonly string[]> = Object.fromEntries(
  MONSTER_SKILLS.map((key) => [key, []]),
)
const ACTIVATION_CHILDREN: Record<string, readonly string[]> = {
  unit: withoutBlank(SPELL_ACTIVATION_UNITS),
  time: [],
}
const CONTAINER_FIELDS: Record<BlockKind, Record<string, Record<string, readonly string[]>>> = {
  spell: { attributes: ATTRIBUTES_CHILDREN, activation: ACTIVATION_CHILDREN },
  item: { attributes: ATTRIBUTES_CHILDREN },
  monster: {
    attributes: ATTRIBUTES_CHILDREN,
    abilities: ABILITY_CHILDREN,
    savingThrows: ABILITY_CHILDREN,
    skills: SKILL_CHILDREN,
  },
  background: { attributes: ATTRIBUTES_CHILDREN },
}

const FENCE_OPEN = /^```\s*(spell|item|monster|background)\b/i
const FENCE_CLOSE = /^```\s*$/
const FIELD_LINE = /^\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*)$/

function indentOf(text: string): number {
  return text.length - text.trimStart().length
}

/** Which known container field (if any) `line` is nested directly under —
 * scans upward within the block for the nearest less-indented bare `key:`
 * line. Only resolves one level of nesting (enough for `attributes:`);
 * returns undefined for a top-level line, or a line nested under anything
 * else (deeper/unlisted nesting isn't covered yet, see CONTAINER_FIELDS). */
function findParentField(document: vscode.TextDocument, region: BlockRegion, line: number): string | undefined {
  const currentIndent = indentOf(document.lineAt(line).text)
  if (currentIndent === 0) {
    return undefined
  }
  for (let cursor = line - 1; cursor >= region.contentStartLine; cursor -= 1) {
    const text = document.lineAt(cursor).text
    if (text.trim() === '') {
      continue
    }
    const indent = indentOf(text)
    if (indent >= currentIndent) {
      continue
    }
    const match = FIELD_LINE.exec(text)
    return match && match[2].trim() === '' ? match[1] : undefined
  }
  return undefined
}

/** Every *closed* ```spell/item/monster/background block in the document — used for
 * diagnostics, so a block still being typed (no closing ``` yet) doesn't
 * get flagged as broken while the user is mid-edit. */
function findClosedBlockRegions(document: vscode.TextDocument): BlockRegion[] {
  const regions: BlockRegion[] = []
  let openKind: BlockKind | undefined
  let openStartLine = -1
  for (let line = 0; line < document.lineCount; line += 1) {
    const text = document.lineAt(line).text.trim()
    if (openKind === undefined) {
      const match = FENCE_OPEN.exec(text)
      if (match) {
        openKind = match[1].toLowerCase() as BlockKind
        openStartLine = line + 1
      }
    } else if (FENCE_CLOSE.test(text)) {
      regions.push({ kind: openKind, contentStartLine: openStartLine, contentEndLine: line })
      openKind = undefined
    }
  }
  return regions
}

/** The block containing `targetLine`, open or not — used for completion,
 * where the most useful moment is exactly while a block is still being
 * typed and has no closing ``` yet. */
function findRegionAtLine(document: vscode.TextDocument, targetLine: number): BlockRegion | undefined {
  let openKind: BlockKind | undefined
  let openStartLine = -1
  const lastLine = Math.min(targetLine, document.lineCount - 1)
  for (let line = 0; line <= lastLine; line += 1) {
    const text = document.lineAt(line).text.trim()
    if (openKind === undefined) {
      const match = FENCE_OPEN.exec(text)
      if (match) {
        openKind = match[1].toLowerCase() as BlockKind
        openStartLine = line + 1
      }
    } else if (FENCE_CLOSE.test(text)) {
      if (targetLine >= openStartLine && targetLine < line) {
        return { kind: openKind, contentStartLine: openStartLine, contentEndLine: line }
      }
      openKind = undefined
    }
  }
  if (openKind !== undefined && targetLine >= openStartLine) {
    return { kind: openKind, contentStartLine: openStartLine, contentEndLine: document.lineCount }
  }
  return undefined
}

/** A container field opened inline on the same line, e.g. `skills: { |` —
 * the snippet's own default for `savingThrows`/`skills` (`{}`), and the
 * established compact style used throughout this project's real examples
 * (`abilities: { str: 24, dex: 15, ... }`). Only handles a *still-open*
 * brace (no matching `}` yet before the cursor) on the current line —
 * multi-line `{ ... }` isn't covered, same as multi-line object nesting
 * generally isn't beyond one level (see findParentField). */
const INLINE_CONTAINER_OPEN = /^\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*\{([^}]*)$/

/** Text since the last comma (or since the opening `{`/line start if
 * there isn't one yet) — the part of an inline `{ a: 1, b: 2, |` that's
 * still being typed, equivalent to `beforeCursor` for a single nested key. */
function currentSegment(text: string): string {
  const lastComma = text.lastIndexOf(',')
  return lastComma === -1 ? text : text.slice(lastComma + 1)
}

function fieldCompletions(fields: readonly string[]): vscode.CompletionItem[] {
  return fields.map((field) => {
    const item = new vscode.CompletionItem(field, vscode.CompletionItemKind.Field)
    item.insertText = `${field}: `
    return item
  })
}

function enumCompletions(values: readonly string[]): vscode.CompletionItem[] {
  return values.map((value) => new vscode.CompletionItem(value, vscode.CompletionItemKind.EnumMember))
}

/** Field-name completion (nothing typed yet, or a key partially typed) and
 * enum-value completion (cursor right after a known field's `:`) for
 * ```spell/item/monster/background blocks — reuses the exact same field-name and
 * enum-value lists the validators/renderer already use. Shared between a
 * block's own top-level fields and a known container field's own children
 * (`attributes:`, `savingThrows: { ... }`, ...), authored either as
 * multi-line indentation or a single-line `{ ... }`. */
class CompendiumBlockCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
    const region = findRegionAtLine(document, position.line)
    if (!region) {
      return undefined
    }

    const beforeCursor = document.lineAt(position.line).text.slice(0, position.character)

    const inlineMatch = INLINE_CONTAINER_OPEN.exec(beforeCursor)
    if (inlineMatch) {
      const container = CONTAINER_FIELDS[region.kind][inlineMatch[1]]
      // An inline-opened container that isn't a known one (e.g. a monster's
      // `speed: { ` isn't covered) — abstain rather than fall back to the
      // block's own top-level fields, which would be wrong here.
      return container ? this.completionsFor(currentSegment(inlineMatch[2]), container) : undefined
    }

    const parentField = findParentField(document, region, position.line)
    const container = parentField ? CONTAINER_FIELDS[region.kind][parentField] : undefined
    if (parentField && !container) {
      return undefined
    }

    return this.completionsFor(beforeCursor, container, FIELD_NAMES[region.kind], ENUM_VALUES[region.kind])
  }

  private completionsFor(
    segment: string,
    container: Record<string, readonly string[]> | undefined,
    topLevelFields?: readonly string[],
    topLevelEnums?: Record<string, readonly string[]>,
  ): vscode.CompletionItem[] | undefined {
    const fieldMatch = FIELD_LINE.exec(segment)
    if (fieldMatch) {
      const values = container ? container[fieldMatch[1]] : topLevelEnums?.[fieldMatch[1]]
      return values && enumCompletions(values)
    }

    // Not just a fully blank segment: also matches once the user has
    // started typing the key itself (e.g. "sa" while typing "savingThrows")
    // — VSCode filters this list client-side against what's typed so far,
    // but only if the provider still returns it instead of bailing out the
    // moment any character exists.
    if (/^\s*[A-Za-z0-9]*$/.test(segment)) {
      const fields = container ? Object.keys(container) : (topLevelFields ?? [])
      return fieldCompletions(fields)
    }

    return undefined
  }
}

function blockDiagnostics(document: vscode.TextDocument): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = []
  for (const region of findClosedBlockRegions(document)) {
    const yamlSource = document.getText(new vscode.Range(region.contentStartLine, 0, region.contentEndLine, 0))
    const parsed =
      region.kind === 'spell'
        ? parseSpellBlock(yamlSource)
        : region.kind === 'item'
          ? parseItemBlock(yamlSource)
          : region.kind === 'monster'
            ? parseMonsterBlock(yamlSource)
            : parseBackgroundBlock(yamlSource)
    if (parsed.issues.length === 0) {
      continue
    }
    // Same as the rendered preview's own error div: a per-block list of
    // issues, not mapped to individual lines (ValidationIssue carries no
    // line info) — anchored to the fence's own opening line so it's easy
    // to spot which block a squiggle belongs to.
    const anchorLine = Math.min(region.contentStartLine - 1, document.lineCount - 1)
    const range = document.lineAt(Math.max(anchorLine, 0)).range
    const message = parsed.issues.map((issue) => issue.message).join(' ')
    diagnostics.push(new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning))
  }
  return diagnostics
}

export function registerCompendiumBlockAssistance(context: vscode.ExtensionContext): void {
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('mpx-compendium-block')

  const refresh = (document: vscode.TextDocument): void => {
    if (document.languageId !== 'markdown') {
      return
    }
    diagnosticCollection.set(document.uri, blockDiagnostics(document))
  }

  context.subscriptions.push(
    diagnosticCollection,
    // No ' ' (space) trigger character: retriggering completion on every
    // space typed inside a free-text field's value (descr, typeDetail, ...)
    // reopened the suggestion widget constantly while composing prose —
    // ':' (right after a field name) and '[' (entering an inline array) are
    // the only positions completion is actually useful at.
    vscode.languages.registerCompletionItemProvider('markdown', new CompendiumBlockCompletionProvider(), ':', '['),
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((event) => refresh(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnosticCollection.delete(document.uri)),
  )

  for (const document of vscode.workspace.textDocuments) {
    refresh(document)
  }
}
