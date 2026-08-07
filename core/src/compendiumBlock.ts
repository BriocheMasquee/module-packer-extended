import { isNonEmptyString, isPlainObject } from './compendiumShared.js'
import { translate, type RenderLocale } from './catalog.js'
import type { MeasurementSystem, ContentLanguage } from './localization.js'

/** Catalog keys follow `{Namespace}.{PascalCase(enumKey)}` — confirmed
 * across every Compendium block type's own enum fields (spell/item's
 * school/type/rarity/..., a monster's size/type/alignment/...). */
export function translateEnum(namespace: string, enumKey: string, locale: RenderLocale): string {
  const pascalKey = enumKey.charAt(0).toUpperCase() + enumKey.slice(1)
  return translate(`${namespace}.${pascalKey}`, locale.language, locale.overrides)
}

/** For a field that accepts a custom value alongside its standard list
 * (e.g. a spell's `school`, an item's `rarity`/`mastery`/`properties` —
 * see each field's own validateXData in its *Compendium.ts) —
 * translateEnum's own catalog lookup falls back to returning the *lookup
 * key itself* when it finds no match (e.g. "SpellSchool.Homebrewschool"),
 * not the original value, so a custom entry must skip translation
 * entirely and render exactly as typed instead — same convention as a
 * monster's languages/environments (see docs). */
export function translateEnumOrCustom(namespace: string, value: string, standardValues: readonly string[], locale: RenderLocale): string {
  return standardValues.includes(value) ? translateEnum(namespace, value, locale) : value
}

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

/** A standalone entity file's own `image`/`token` field (e.g. `spells/x.png`,
 * `monsters/y.png`) or an inline block's (e.g. `images/x.png`, see
 * INLINE_IMAGE_PATTERN) is relative to the project root — same `../`
 * adjustment `installImageRendering` already applies to a page's own
 * `images/...` paths, needed for the same reason: a page file lives one
 * level deeper, in `pages/`, than the project root the path is actually
 * relative to. */
export function resourceImagePath(resourcePath: string, preview: boolean | undefined): string {
  return preview ? `../${resourcePath}` : resourcePath
}

/** An inline `image`/`token` field is authored relative to the project's
 * `images/` folder — the same folder an ordinary page image lives in —
 * not the entity's own folder (`items/`, `spells/`, `monsters/`,
 * `backgrounds/`) a *standalone* file's `image`/`token` uses. This is the
 * fix for a real bug found via a live EncounterPlus import: a page's
 * rendered HTML only ever resolves an embedded `<img>` relative to the
 * module's `images/` folder, never an entity folder — an inline block
 * whose `image` pointed at `items/x.png` (mirroring the standalone
 * convention) rendered fine in the entity's own Compendium detail view
 * once merged into `items.json`, but never showed up in the page itself.
 * Flat only (`images/<file>`, no subfolder) — avoids any filename
 * collision when the same file is optionally also copied into the
 * entity's own folder (see `addImageToCompendium`/`addTokenToCompendium`
 * in each block's DisplayDefaults), which requires a flat path there too. */
export const INLINE_IMAGE_PATTERN = /^images\/[^/\\]+$/

/** The bare basename of an `images/<file>` path — used to derive the
 * entity-folder archive path (`items/<file>`, ...) when an inline block's
 * image/token is also copied into the Compendium at build time. */
export function inlineImageBasename(imagesPath: string): string {
  return imagesPath.slice('images/'.length)
}

/** Distance and weight values are authored in whichever unit an entry's own
 * `attributes.measurement` says (imperial: feet/pounds, metric:
 * meters/kilograms) — shown as-is when that matches the project's active
 * measurement, or converted when it doesn't. Distance uses the same
 * simplified ×0.3 factor as WotC's own licensed French translations for
 * feet -> meters. Weight uses the common tabletop rule-of-thumb factor of
 * ×0.5 (1 lb ≈ 0.5 kg — a rounder, faster-to-eyeball simplification than
 * the real-world 0.4536, in the same spirit as the distance factor). Both
 * reverse directions (meters -> feet, kg -> lb) are the plain inverse (no
 * official reference exists for those, D&D's own rules are always
 * feet/pounds-first). When an entry has no explicit `attributes.measurement`
 * (the common case for freshly-authored content), its numbers are treated
 * as already being in the project's *current* active unit — no conversion,
 * i.e. authored natively. Shared by every distance shown in a spell/
 * monster block (a spell's range/area, a monster's speed/senses) and an
 * item's weight/capacity. */
const FEET_TO_METERS_FACTOR = 0.3
const LB_TO_KG_FACTOR = 0.5

export function resolveAuthoredMeasurement(attributes: unknown): MeasurementSystem | undefined {
  if (!isPlainObject(attributes)) {
    return undefined
  }
  return attributes.measurement === 'imperial' || attributes.measurement === 'metric' ? attributes.measurement : undefined
}

function convert(
  value: number,
  authoredMeasurement: MeasurementSystem | undefined,
  displayMeasurement: MeasurementSystem,
  factor: number,
): number {
  if (!authoredMeasurement || authoredMeasurement === displayMeasurement) {
    return value
  }
  return authoredMeasurement === 'imperial' ? Math.round(value * factor * 2) / 2 : Math.round(value / factor)
}

export function resolveDistanceValue(
  value: number,
  authoredMeasurement: MeasurementSystem | undefined,
  displayMeasurement: MeasurementSystem,
): number {
  return convert(value, authoredMeasurement, displayMeasurement, FEET_TO_METERS_FACTOR)
}

export function resolveWeightValue(
  value: number,
  authoredMeasurement: MeasurementSystem | undefined,
  displayMeasurement: MeasurementSystem,
): number {
  return convert(value, authoredMeasurement, displayMeasurement, LB_TO_KG_FACTOR)
}

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

/** "Name, p. 178" (English) / "Nom, page 178" (French, "page" spelled out
 * rather than abbreviated) — confirmed against a real EncounterPlus-
 * rendered card. */
export function formatSources(sources: unknown, language: ContentLanguage): string | undefined {
  if (!Array.isArray(sources)) {
    return undefined
  }
  const pageWord = language === 'fr' ? 'page' : 'p.'
  const parts = sources
    .filter(isPlainObject)
    .map((source) => {
      if (!isNonEmptyString(source.name)) {
        return undefined
      }
      const page = typeof source.page === 'number' ? `, ${pageWord} ${source.page}` : ''
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
