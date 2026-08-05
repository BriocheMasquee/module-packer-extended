import { isNonEmptyString, isPlainObject } from './compendiumShared.js'
import type { MeasurementSystem, ContentLanguage } from './localization.js'

/** Shared by every inline Compendium block renderer (spell, item, ...) —
 * escapes text dropped into the `.compendium-block` markup. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** Theme images live in the project's own `assets/img/` (copied there at
 * project creation) — same folder the theme's CSS already references via
 * `../img/...`, just resolved from an <img> tag instead of a stylesheet. */
export function themeAssetPath(fileName: string, preview: boolean | undefined): string {
  return `${preview ? '../' : ''}assets/img/${fileName}`
}

/** A spell/item/monster's own `image`/`token` field (e.g. `spells/x.png`,
 * `monsters/y.png`) is relative to the project root — same `../` adjustment
 * `installImageRendering` already applies to a page's own `images/...`
 * paths, needed for the same reason: a page file lives one level deeper,
 * in `pages/`, than the project root the path is actually relative to. */
export function resourceImagePath(resourcePath: string, preview: boolean | undefined): string {
  return preview ? `../${resourcePath}` : resourcePath
}

/** Distance values are authored directly in the project's active measurement
 * unit — feet when imperial, meters when metric — and shown as-is, no
 * conversion. Same "no single canonical unit to convert from" reasoning as
 * item weight/capacity (see formatWeight below); a project switching
 * measurement mid-way re-interprets its existing numbers in the new unit
 * rather than converting them. Shared by every distance shown in a spell/
 * monster block (a spell's range/area, a monster's speed/senses). */
export function formatDistanceNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** The plain unit word appended after a spell range's number (e.g. "9
 * meters"/"9 mètres", "1 meter"/"1 mètre") — MPX-authored, not sourced from
 * the upstream EncounterPlus catalog (it has no key for this), so untouched
 * by scripts/sync-catalogs.mjs. No French word is given for imperial
 * ("feet") since French projects default to metric — see
 * resolveMeasurementSystem. */
export function distanceUnitWord(measurement: MeasurementSystem, language: ContentLanguage, count: number): string {
  if (measurement === 'metric') {
    if (language === 'fr') {
      return count === 1 ? 'mètre' : 'mètres'
    }
    return count === 1 ? 'meter' : 'meters'
  }
  return 'feet'
}

/** "Label: value" in English, "Label : value" in French (a non-breaking
 * space before the colon is standard French typography, unlike English)
 * — MPX-authored, not from the EncounterPlus catalog (its labels are the
 * words themselves; the surrounding punctuation is this renderer's own).
 * Shared by every "Label: value" detail/property line across the spell/
 * item/monster block renderers. */
export function labelSeparator(language: ContentLanguage): string {
  return language === 'fr' ? '&nbsp;: ' : ': '
}

export function formatSources(sources: unknown): string | undefined {
  if (!Array.isArray(sources)) {
    return undefined
  }
  const parts = sources
    .filter(isPlainObject)
    .map((source) => {
      if (!isNonEmptyString(source.name)) {
        return undefined
      }
      const page = typeof source.page === 'number' ? ` p.${source.page}` : ''
      return `${source.name}${page}`
    })
    .filter((entry): entry is string => entry !== undefined)
  return parts.length > 0 ? parts.join('; ') : undefined
}

export function formatTags(tags: unknown): string | undefined {
  if (!Array.isArray(tags)) {
    return undefined
  }
  const parts = tags.filter((entry): entry is string => typeof entry === 'string')
  return parts.length > 0 ? parts.join(', ') : undefined
}
