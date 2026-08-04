import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { listFilesRecursively } from './fileScan.js'
import { isNonEmptyString } from './compendiumShared.js'

export const DEFAULT_PROJECT_THEME_ID = '5.5e'

/** A theme's id doubles as its folder name inside resources/themes and the
 * value stored in mpx.projectTheme — "5.5e" itself needs the dot, unlike a
 * regular content slug (see slug.ts's stricter SLUG_PATTERN), so this is its
 * own pattern rather than a reuse of that one. */
const THEME_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/

/** Files a resync never touches once they exist in the project — they're
 * the project's own customization layer, seeded from the theme's template
 * only the first time (see replaceProjectThemeAssets). */
const USER_CUSTOMIZATION_FILES = new Set(['css/custom.css', 'js/custom.js'])

/** Metadata-only files that live in the extension's bundled theme folder
 * but should never end up copied into a project's own assets/. */
const NEVER_INSTALL_FILE_NAMES = new Set(['theme.json'])

export interface ProjectTheme {
  id: string
  name: string
  description: string
  /** Absolute path to the theme's folder in the extension's bundled
   * resources/themes/<id>/ — holds css/img/js/font directly (no extra
   * nesting), plus its own theme.json manifest. */
  themeDirectory: string
}

interface ThemeManifest {
  id?: unknown
  name?: unknown
  description?: unknown
}

function portablePath(path: string): string {
  return path.split(sep).join('/')
}

/** Reads every resources/themes/<id>/theme.json the extension bundles —
 * only "5.5e" today, but built to support more without call-site changes
 * once a second theme (e.g. issue #6's "legacy") exists. A malformed or
 * mismatched manifest is skipped rather than failing the whole scan, same
 * defensive spirit as a build's per-file validation. */
export async function discoverProjectThemes(themesDirectory: string): Promise<ProjectTheme[]> {
  const entries = await readdir(themesDirectory, { withFileTypes: true }).catch(() => [])
  const themes: ProjectTheme[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue
    }
    const themeDirectory = join(themesDirectory, entry.name)
    let manifest: ThemeManifest
    try {
      manifest = JSON.parse(await readFile(join(themeDirectory, 'theme.json'), 'utf8')) as ThemeManifest
    } catch {
      continue
    }
    if (
      !isNonEmptyString(manifest.id) ||
      !THEME_ID_PATTERN.test(manifest.id) ||
      manifest.id !== entry.name ||
      !isNonEmptyString(manifest.name) ||
      !isNonEmptyString(manifest.description)
    ) {
      continue
    }
    themes.push({
      id: manifest.id,
      name: manifest.name.trim(),
      description: manifest.description.trim(),
      themeDirectory,
    })
  }

  return themes.sort((left, right) => left.name.localeCompare(right.name))
}

export function resolveProjectTheme(themes: readonly ProjectTheme[], themeId: string): ProjectTheme | undefined {
  return themes.find((theme) => theme.id === themeId)
}

async function collectAssetFiles(root: string, excluded: ReadonlySet<string>): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>()
  for (const filePath of await listFilesRecursively(root)) {
    const relativePath = portablePath(relative(root, filePath))
    if (excluded.has(relativePath) || NEVER_INSTALL_FILE_NAMES.has(relativePath.split('/').pop() ?? '')) {
      continue
    }
    files.set(relativePath, await readFile(filePath))
  }
  return files
}

/** True once every one of the theme's own managed files (everything except
 * the user-customization ones) is present in the project's assets/ with
 * matching content — false the moment the extension ships an updated theme
 * file the project hasn't picked up yet (see issue #27). */
export async function projectAssetsMatchTheme(projectDirectory: string, theme: ProjectTheme): Promise<boolean> {
  const [projectFiles, themeFiles] = await Promise.all([
    collectAssetFiles(join(projectDirectory, 'assets'), new Set()),
    collectAssetFiles(theme.themeDirectory, USER_CUSTOMIZATION_FILES),
  ])
  for (const [filePath, themeContent] of themeFiles) {
    if (!projectFiles.get(filePath)?.equals(themeContent)) {
      return false
    }
  }
  return true
}

/** Copies every one of the theme's managed files into the project's
 * assets/, overwriting whatever was there — the fix for both a fresh
 * project (issue #6) and a stale one (issue #27: an extension update
 * shipped theme changes the project never picked up). css/custom.css and
 * js/custom.js are never overwritten once they exist (that's the project's
 * own customization layer — see USER_CUSTOMIZATION_FILES), only seeded from
 * the theme's own template the first time they're missing.
 *
 * Staged in a temp directory and swapped in with a rename, with the
 * previous assets/ kept as a backup until the swap succeeds — a failure
 * partway through (e.g. a full disk) leaves the original assets/ untouched
 * rather than a half-copied folder. */
export async function replaceProjectThemeAssets(projectDirectory: string, theme: ProjectTheme): Promise<void> {
  const assetsDirectory = join(projectDirectory, 'assets')
  const operationId = randomUUID()
  const stagedDirectory = join(projectDirectory, `.assets-mpx-${operationId}`)
  const backupDirectory = join(projectDirectory, `.assets-mpx-backup-${operationId}`)
  const hadAssets = await readdir(assetsDirectory)
    .then(() => true)
    .catch(() => false)

  await mkdir(stagedDirectory, { recursive: true })

  // Customization files: preserve the project's own copy if it already has
  // one, staged before the theme's own files below so they never get
  // clobbered by them.
  for (const relativePath of USER_CUSTOMIZATION_FILES) {
    const stagedPath = join(stagedDirectory, relativePath)
    await mkdir(dirname(stagedPath), { recursive: true })
    await copyFile(join(assetsDirectory, relativePath), stagedPath).catch(() => undefined)
  }

  for (const filePath of await listFilesRecursively(theme.themeDirectory)) {
    const relativePath = portablePath(relative(theme.themeDirectory, filePath))
    if (NEVER_INSTALL_FILE_NAMES.has(relativePath.split('/').pop() ?? '')) {
      continue
    }
    const targetPath = join(stagedDirectory, relativePath)
    if (USER_CUSTOMIZATION_FILES.has(relativePath)) {
      // Only seed from the theme's template when the project didn't already
      // have its own copy (staged above).
      const alreadyStaged = await readFile(targetPath)
        .then(() => true)
        .catch(() => false)
      if (alreadyStaged) {
        continue
      }
    }
    await mkdir(dirname(targetPath), { recursive: true })
    await copyFile(filePath, targetPath)
  }

  try {
    if (hadAssets) {
      await rename(assetsDirectory, backupDirectory)
    }
    await rename(stagedDirectory, assetsDirectory)
    if (hadAssets) {
      await rm(backupDirectory, { recursive: true, force: true })
    }
  } catch (error) {
    await rm(stagedDirectory, { recursive: true, force: true })
    if (hadAssets) {
      const assetsMissing = await readdir(assetsDirectory)
        .then(() => false)
        .catch(() => true)
      if (assetsMissing) {
        await rename(backupDirectory, assetsDirectory)
      }
    }
    throw error
  }
}
