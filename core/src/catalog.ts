import { CATALOG_EN } from './catalogEn.js'
import { CATALOG_FR } from './catalogFr.js'
import type { ContentLanguage, MeasurementSystem } from './localization.js'

type CatalogEntry = string | { one: string; many: string }

/** A project's `translation-overrides.json`, loaded once and passed through
 * every render call — renames a catalog key's displayed word project-wide,
 * for every place that key is used, regardless of which YAML entry
 * triggered the lookup. Keyed per-language so an override only replaces the
 * word shown in that language. */
export type CatalogOverrides = Partial<Record<ContentLanguage, Record<string, CatalogEntry>>>

/** Bundles every render-time locale concern threaded through the spell/item/
 * monster block renderers — measurement, language, and the project's own
 * catalog overrides all travel together since nearly every formatting
 * helper needs some combination of the three. */
export interface RenderLocale {
  measurement: MeasurementSystem
  language: ContentLanguage
  overrides?: CatalogOverrides
}

function catalogFor(language: ContentLanguage): Record<string, CatalogEntry> {
  return language === 'fr' ? CATALOG_FR : CATALOG_EN
}

function resolveEntry(key: string, language: ContentLanguage, overrides?: CatalogOverrides): CatalogEntry | undefined {
  return overrides?.[language]?.[key] ?? catalogFor(language)[key]
}

export function translate(key: string, language: ContentLanguage, overrides?: CatalogOverrides): string {
  const entry = resolveEntry(key, language, overrides)
  if (entry === undefined) {
    return key
  }
  return typeof entry === 'string' ? entry : entry.one
}

export function pluralize(key: string, count: number, language: ContentLanguage, overrides?: CatalogOverrides): string {
  const entry = resolveEntry(key, language, overrides)
  if (entry === undefined) {
    return key
  }
  if (typeof entry === 'string') {
    return entry
  }
  return count === 1 ? entry.one : entry.many
}
