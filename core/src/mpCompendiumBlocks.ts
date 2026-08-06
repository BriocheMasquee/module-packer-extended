import { parse as parseYaml } from 'yaml'
import { isPlainObject } from './compendiumShared.js'
import { ITEM_RARITIES, ITEM_TYPES } from './itemCompendium.js'
import { SPELL_COMPONENTS, SPELL_SCHOOLS } from './spellCompendium.js'

// ---------------------------------------------------------------------------
// Reshapes MP (Module Packer V4)'s own inline ```Item/```Spell block field
// vocabulary — free-text, kebab-case, comma-separated — into MPX's current
// flat field vocabulary (structured activation/duration, arrays, descr,
// showImage, ...), the shape core/src/spellBlock.ts and itemBlock.ts
// actually render. Best-effort: free-text fields (casting time, duration)
// are parsed against known patterns; anything unrecognized is left unset
// and reported as a notice rather than guessed.
// ---------------------------------------------------------------------------

export interface MpCompendiumFieldNotice {
  field: string
  message: string
  originalValue: string
}

export interface MpCompendiumBlockReshape {
  /** The block's own name, for notices — undefined if the block has none
   * (already a separate, reported problem). */
  name?: string
  fieldNotices: MpCompendiumFieldNotice[]
  /** The block's original `image:` value (MP: a bare filename, resolved
   * relative to the page it's in, same as a page's own image references) —
   * undefined when the block has no image. The caller is responsible for
   * copying this file into the destination spells//items/ folder; `yaml`
   * already points at it under its new "spells/<file>"/"items/<file>" path. */
  imageReference?: string
  kind: 'item' | 'spell'
  yaml: string
}

export interface ReshapeMpCompendiumBlocksResult {
  blocks: MpCompendiumBlockReshape[]
  content: string
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return undefined
}

function bool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    if (/^(true|yes)$/i.test(value.trim())) {
      return true
    }
    if (/^(false|no)$/i.test(value.trim())) {
      return false
    }
  }
  return undefined
}

/** Case/space/hyphen-insensitive match against a known enum — "Very Rare"
 * matches "veryrare", "Melee Weapon" matches "meleeWeapon" (compared with
 * its own separators stripped too). */
function matchEnum(value: string, candidates: readonly string[]): string | undefined {
  const normalized = value.toLowerCase().replace(/[\s_-]/g, '')
  return candidates.find((candidate) => candidate.toLowerCase().replace(/[\s_-]/g, '') === normalized)
}

function splitCommaList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

interface ParsedActivation {
  condition?: string
  notice?: string
  time?: number
  unit?: string
}

/** MP wrote casting time as free text ("1 action", "1 bonus action",
 * "10 minutes", "1 reaction, which you take when..."). Matches the known
 * MPX units; a trailing comma clause on a reaction becomes `condition`.
 * Anything else (e.g. "Special") is left unset and reported. */
function parseMpActivation(raw: string): ParsedActivation {
  const [main, ...rest] = raw.split(',')
  const condition = rest.join(',').trim() || undefined
  const text = main.trim()

  const bonusActionMatch = /^(\d+)?\s*bonus\s*actions?$/i.test(text)
  if (bonusActionMatch) {
    return { time: 1, unit: 'bonusAction', condition }
  }
  const reactionMatch = /^(\d+)?\s*reactions?$/i.test(text)
  if (reactionMatch) {
    return { time: 1, unit: 'reaction', condition }
  }
  const actionMatch = text.match(/^(\d+)\s*actions?$/i)
  if (actionMatch) {
    return { time: Number(actionMatch[1]), unit: 'action', condition }
  }
  const hourMatch = text.match(/^(\d+)\s*hours?$/i)
  if (hourMatch) {
    return { time: Number(hourMatch[1]), unit: 'hour', condition }
  }
  const minuteMatch = text.match(/^(\d+)\s*minutes?$/i)
  if (minuteMatch) {
    return { time: Number(minuteMatch[1]), unit: 'minute', condition }
  }
  return { notice: `Casting time "${raw}" wasn't recognized — left blank, fill in manually.` }
}

interface ParsedDuration {
  duration?: number
  durationType?: string
  durationUnit?: string
  notice?: string
}

const DURATION_UNIT_WORDS: Record<string, string> = { round: 'round', rounds: 'round', minute: 'minute', minutes: 'minute', hour: 'hour', hours: 'hour', day: 'day', days: 'day' }

/** MP wrote duration as free text too ("Instantaneous", "Until dispelled",
 * "Concentration, up to 1 minute", "8 hours"). */
function parseMpDuration(raw: string): ParsedDuration {
  const text = raw.trim()
  if (/^instantaneous$/i.test(text)) {
    return { durationType: 'instantaneous' }
  }
  if (/^special$/i.test(text)) {
    return { durationType: 'special' }
  }
  if (/dispelled\s+or\s+triggered/i.test(text)) {
    return { durationType: 'dispelOrTrigger' }
  }
  if (/^until\s+dispelled$/i.test(text) || /^dispelled$/i.test(text)) {
    return { durationType: 'dispel' }
  }

  const concentrationMatch = text.match(/^concentration\s*,?\s*(?:up\s*to\s*)?(?:(\d+)\s*(round|rounds|minute|minutes|hour|hours|day|days))?$/i)
  if (concentrationMatch) {
    const [, amount, unit] = concentrationMatch
    return {
      durationType: 'concentration',
      duration: amount ? Number(amount) : undefined,
      durationUnit: unit ? DURATION_UNIT_WORDS[unit.toLowerCase()] : undefined,
    }
  }

  const timedMatch = text.match(/^(\d+)\s*(round|rounds|minute|minutes|hour|hours|day|days)$/i)
  if (timedMatch) {
    return { duration: Number(timedMatch[1]), durationUnit: DURATION_UNIT_WORDS[timedMatch[2].toLowerCase()] }
  }

  return { notice: `Duration "${raw}" wasn't recognized — left blank, fill in manually.` }
}

function reshapeMpSpellYaml(
  raw: Record<string, unknown>,
): { fieldNotices: MpCompendiumFieldNotice[]; imageReference?: string; yaml: string } {
  const fieldNotices: MpCompendiumFieldNotice[] = []
  const name = str(raw.name) ?? 'Unnamed Spell'
  const slug = str(raw.slug)
  const level = num(raw.level)
  const rawSchool = str(raw.school)
  const school = rawSchool ? matchEnum(rawSchool, SPELL_SCHOOLS) : undefined
  if (rawSchool && !school) {
    fieldNotices.push({ field: 'school', message: `School "${rawSchool}" isn't a recognized 5.5e school — left blank.`, originalValue: rawSchool })
  }
  const ritual = bool(raw.ritual)
  const rawTime = str(raw.time)
  const activation = rawTime ? parseMpActivation(rawTime) : undefined
  if (activation?.notice && rawTime) {
    fieldNotices.push({ field: 'activation', message: activation.notice, originalValue: rawTime })
  }
  const range = num(raw.range)
  const rawComponents = str(raw.components)
  const unrecognizedComponents = rawComponents
    ? splitCommaList(rawComponents).filter((component) => !SPELL_COMPONENTS.includes(component.toUpperCase().charAt(0)))
    : []
  const normalizedComponents = rawComponents
    ? splitCommaList(rawComponents)
        .map((component) => component.toUpperCase().charAt(0))
        .filter((letter) => SPELL_COMPONENTS.includes(letter))
    : []
  if (unrecognizedComponents.length > 0) {
    fieldNotices.push({
      field: 'components',
      message: `Component(s) "${unrecognizedComponents.join(', ')}" weren't recognized (expected V/S/M) — dropped.`,
      originalValue: rawComponents ?? '',
    })
  }
  const rawDuration = str(raw.duration)
  const duration = rawDuration ? parseMpDuration(rawDuration) : undefined
  if (duration?.notice && rawDuration) {
    fieldNotices.push({ field: 'duration', message: duration.notice, originalValue: rawDuration })
  }
  const descr = str(raw.description)
  const rawClasses = str(raw.classes)
  const classes = rawClasses ? splitCommaList(rawClasses) : []
  const image = str(raw.image)
  const showImage = bool(raw['show-image'])

  const lines: string[] = []
  lines.push(`name: ${JSON.stringify(name)}`)
  if (slug) {
    lines.push(`slug: ${JSON.stringify(slug)}`)
  }
  if (image) {
    lines.push(`image: ${JSON.stringify(`spells/${image}`)}`)
  }
  if (showImage !== undefined) {
    lines.push(`showImage: ${showImage}`)
  }
  if (level !== undefined) {
    lines.push(`level: ${level}`)
  }
  if (school) {
    lines.push(`school: ${JSON.stringify(school)}`)
  }
  if (ritual !== undefined) {
    lines.push(`ritual: ${ritual}`)
  }
  if (activation && (activation.time !== undefined || activation.unit || activation.condition)) {
    lines.push('activation:')
    if (activation.time !== undefined) {
      lines.push(`  time: ${activation.time}`)
    }
    if (activation.unit) {
      lines.push(`  unit: ${JSON.stringify(activation.unit)}`)
    }
    if (activation.condition) {
      lines.push(`  condition: ${JSON.stringify(activation.condition)}`)
    }
  }
  if (range !== undefined) {
    lines.push(`range: ${range}`)
  }
  if (normalizedComponents.length > 0) {
    lines.push(`components: [${normalizedComponents.join(', ')}]`)
  }
  if (duration?.durationType) {
    lines.push(`durationType: ${JSON.stringify(duration.durationType)}`)
  }
  if (duration?.duration !== undefined) {
    lines.push(`duration: ${duration.duration}`)
  }
  if (duration?.durationUnit) {
    lines.push(`durationUnit: ${JSON.stringify(duration.durationUnit)}`)
  }
  if (classes.length > 0) {
    lines.push(`classes: [${classes.map((value) => JSON.stringify(value)).join(', ')}]`)
  }
  if (descr) {
    lines.push(`descr: ${JSON.stringify(descr)}`)
  }

  return { fieldNotices, imageReference: image, yaml: lines.join('\n') }
}

function reshapeMpItemYaml(
  raw: Record<string, unknown>,
): { fieldNotices: MpCompendiumFieldNotice[]; imageReference?: string; yaml: string } {
  const fieldNotices: MpCompendiumFieldNotice[] = []
  const name = str(raw.name) ?? 'Unnamed Item'
  const slug = str(raw.slug)
  const rawType = str(raw.type)
  const type = rawType ? matchEnum(rawType, ITEM_TYPES) : undefined
  const typeDetail = rawType && !type ? rawType : undefined
  if (rawType && !type) {
    fieldNotices.push({ field: 'type', message: `Item type "${rawType}" isn't a recognized MPX type — kept as "custom" with the original text in typeDetail.`, originalValue: rawType })
  }
  const rawRarity = str(raw.rarity)
  const rarity = rawRarity ? matchEnum(rawRarity, ITEM_RARITIES) : undefined
  if (rawRarity && !rarity) {
    fieldNotices.push({ field: 'rarity', message: `Rarity "${rawRarity}" isn't a recognized MPX rarity — left blank.`, originalValue: rawRarity })
  }
  const descr = str(raw.description)
  const image = str(raw.image)
  const showImage = bool(raw['show-image'])

  const lines: string[] = []
  lines.push(`name: ${JSON.stringify(name)}`)
  if (slug) {
    lines.push(`slug: ${JSON.stringify(slug)}`)
  }
  if (image) {
    lines.push(`image: ${JSON.stringify(`items/${image}`)}`)
  }
  if (showImage !== undefined) {
    lines.push(`showImage: ${showImage}`)
  }
  if (type && !typeDetail) {
    lines.push(`type: ${JSON.stringify(type)}`)
  } else if (typeDetail) {
    lines.push(`type: "custom"`)
    lines.push(`typeDetail: ${JSON.stringify(typeDetail)}`)
  }
  if (rarity) {
    lines.push(`rarity: ${JSON.stringify(rarity)}`)
  }
  if (descr) {
    lines.push(`descr: ${JSON.stringify(descr)}`)
  }

  return { fieldNotices, imageReference: image, yaml: lines.join('\n') }
}

/** Finds every fenced ```Item/```Spell block (MP's own, case-insensitive
 * fence info string) in a page's Markdown content and replaces its YAML
 * body with the MPX-shaped equivalent. Monster blocks aren't included: MP
 * has no inline Monster authoring (confirmed against the old MPX repo's own
 * conversion tests — nothing exercises it). */
export function reshapeMpCompendiumBlocks(content: string): ReshapeMpCompendiumBlocksResult {
  const blocks: MpCompendiumBlockReshape[] = []
  const lines = content.split(/\r?\n/)
  const output: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const fenceMatch = line.match(/^(\s*)(```+|~~~+)\s*(item|spell)\s*$/i)
    if (!fenceMatch) {
      output.push(line)
      index += 1
      continue
    }

    const [, indent, fence, kindMatch] = fenceMatch
    const kind = kindMatch.toLowerCase() as 'item' | 'spell'
    const closeIndex = lines.findIndex(
      (candidate, candidateIndex) => candidateIndex > index && new RegExp(`^\\s*${fence}\\s*$`).test(candidate),
    )
    if (closeIndex === -1) {
      // No closing fence — leave the rest untouched, matching how the
      // renderer's own error handling treats an unclosed block.
      output.push(...lines.slice(index))
      break
    }

    const yamlSource = lines.slice(index + 1, closeIndex).join('\n')
    let parsed: unknown
    try {
      parsed = parseYaml(yamlSource)
    } catch {
      // Invalid YAML: leave the block exactly as-is rather than lose data.
      output.push(...lines.slice(index, closeIndex + 1))
      index = closeIndex + 1
      continue
    }
    if (!isPlainObject(parsed)) {
      output.push(...lines.slice(index, closeIndex + 1))
      index = closeIndex + 1
      continue
    }

    const reshaped = kind === 'spell' ? reshapeMpSpellYaml(parsed) : reshapeMpItemYaml(parsed)
    blocks.push({
      fieldNotices: reshaped.fieldNotices,
      imageReference: reshaped.imageReference,
      kind,
      name: str(parsed.name),
      yaml: reshaped.yaml,
    })

    output.push(`${indent}${fence}${kind}`)
    output.push(...reshaped.yaml.split('\n').map((line_) => `${indent}${line_}`))
    output.push(`${indent}${fence}`)
    index = closeIndex + 1
  }

  return { blocks, content: output.join('\n') }
}
