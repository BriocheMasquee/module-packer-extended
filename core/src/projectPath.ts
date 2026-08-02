import { isAbsolute, relative, resolve } from 'node:path'

/**
 * Resolves a path relative to the project root, refusing to escape it
 * (e.g. "../../../etc/passwd" or an absolute path).
 */
export function resolveProjectFile(moduleRoot: string, relativePath: string): string {
  const resolved = resolve(moduleRoot, relativePath)
  const relativeToRoot = relative(moduleRoot, resolved)
  if (isAbsolute(relativePath) || relativeToRoot.startsWith('..') || isAbsolute(relativeToRoot)) {
    throw new Error(`contains a path outside the project: "${relativePath}".`)
  }
  return resolved
}
