const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/

/** Bumps the patch number of a "major.minor.patch" version string. Returns
 * the input unchanged if it doesn't match that shape. */
export function incrementPatchVersion(version: string): string {
  const match = SEMVER_PATTERN.exec(version)
  if (!match) {
    return version
  }
  const [, major, minor, patch] = match
  return `${major}.${minor}.${Number(patch) + 1}`
}
