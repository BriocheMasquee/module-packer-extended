import { isNonEmptyString, isPlainObject } from './compendiumShared.js'

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
