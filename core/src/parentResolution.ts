export interface SlugParented {
  slug?: string
  parentSlug?: string
}

/**
 * Resolves each entry's parent by matching parentSlug against other entries' slug.
 * A parent link is only trusted when the slug match is unambiguous (exactly one
 * entry has that slug) and doesn't create a cycle; otherwise the entry has no
 * resolved parent (treated as a root) rather than breaking the whole build/tree.
 */
export function resolveParents<T extends SlugParented>(entries: readonly T[]): Map<T, T> {
  const entriesBySlug = new Map<string, T[]>()
  for (const entry of entries) {
    if (!entry.slug) {
      continue
    }
    const matches = entriesBySlug.get(entry.slug) ?? []
    matches.push(entry)
    entriesBySlug.set(entry.slug, matches)
  }

  const candidateParent = new Map<T, T>()
  for (const entry of entries) {
    if (!entry.parentSlug) {
      continue
    }
    const matches = entriesBySlug.get(entry.parentSlug)
    if (matches?.length === 1 && matches[0] !== entry) {
      candidateParent.set(entry, matches[0])
    }
  }

  const validAncestry = new Map<T, boolean>()
  function canNest(entry: T, visiting: Set<T>): boolean {
    const cached = validAncestry.get(entry)
    if (cached !== undefined) {
      return cached
    }
    if (visiting.has(entry)) {
      return false
    }
    const parent = candidateParent.get(entry)
    if (!parent) {
      validAncestry.set(entry, true)
      return true
    }
    const nextVisiting = new Set(visiting)
    nextVisiting.add(entry)
    const result = canNest(parent, nextVisiting)
    validAncestry.set(entry, result)
    return result
  }

  const resolvedParent = new Map<T, T>()
  for (const entry of entries) {
    const parent = candidateParent.get(entry)
    if (parent && canNest(entry, new Set())) {
      resolvedParent.set(entry, parent)
    }
  }
  return resolvedParent
}
