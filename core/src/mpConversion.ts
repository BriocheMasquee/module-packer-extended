import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import matter from 'gray-matter'
import { parse as parseYaml } from 'yaml'
import { ZipFile } from 'yazl'
import { isPlainObject } from './compendiumShared.js'
import { listFilesRecursively } from './fileScan.js'
import { readExportArchive } from './mapEncounterExport.js'
import { reshapeMpCompendiumBlocks, type MpCompendiumBlockReshape } from './mpCompendiumBlocks.js'
import { isValidSlug, slugify } from './slug.js'
import type { ProjectTheme } from './themeCatalog.js'
import { isUuid } from './uuid.js'

// ---------------------------------------------------------------------------
// Analysis — a read-only walk of an MP (Module Packer V4) project folder.
// Ported from the old private MPX repo's v4ProjectAnalyzer.ts, trimmed to
// this project's own conventions (isNonEmptyString/slugify/etc.) and to the
// "structural skeleton" scope: module metadata, pages (incl.
// module-pagebreaks), groups, images, and the assets/ folder. Compendium
// block reshaping and maps/encounters archive conversion are separate,
// later phases — this only *notices* their presence.
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp'])
const TECHNICAL_DIRECTORIES = new Set(['__macosx', 'assets', 'modulebuild', 'node_modules'])

export interface MpAnalysisNotice {
  code: string
  message: string
  path?: string
}

export interface MpModuleAnalysis {
  acronym: string
  author: string
  /** MP has no explicit language field — guessed from descr's own text
   * (French stop-word/accent heuristic), since content language otherwise
   * has no signal anywhere in a MP project. */
  autoDetectedLanguage: 'en' | 'fr'
  autoDetectRollTables: boolean
  category: string
  descr: string
  id?: string
  image: string
  name: string
  slug: string
  version: string
}

export interface MpGroupAnalysis {
  name: string
  parentSlug?: string
  rank: number
  slug: string
  sourcePath: string
}

export interface MpPageAnalysis {
  headingLevel?: number
  name: string
  origin: 'file' | 'heading'
  parentKind?: 'group' | 'page'
  parentSlug?: string
  rank: number
  slug: string
  sourcePath: string
}

export interface MpArchiveReference {
  kind: 'encounter' | 'map'
  /** MP's own Module.yaml declaration has no name field for a map/encounter
   * reference (only path/order/parent/slug) — MP itself only learns the
   * real name by reading the .zip's own manifest at build time. Since MPX
   * doesn't parse the archive, this is a readable fallback derived from the
   * .zip's file name. */
  name: string
  parentSlug?: string
  rank: number
  slug: string
  sourcePath: string
}

export interface MpImageAnalysis {
  path: string
  referenced: boolean
  role: 'content' | 'module'
}

export interface MpAssetsAnalysis {
  directory?: string
}

export interface MpProjectAnalysis {
  archives: MpArchiveReference[]
  assets: MpAssetsAnalysis
  compendiumBlockCount: number
  excludedPageCount: number
  groups: MpGroupAnalysis[]
  images: MpImageAnalysis[]
  module: MpModuleAnalysis
  modulePath: string
  notices: MpAnalysisNotice[]
  pages: MpPageAnalysis[]
  projectDirectory: string
}

interface DirectoryContext {
  includeIn: string
  parentGroupSlug?: string
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// French accented letters and common short stop-words are a strong enough
// signal for a module description's length of text — a full statistical
// language detector would be overkill for a couple of sentences, and MP
// has no dedicated language field to read instead.
const FRENCH_ACCENT_PATTERN = /[àâäçèéêëîïôöùûüÿœæ]/i
const FRENCH_STOP_WORDS = new Set([
  'de', 'des', 'du', 'le', 'la', 'les', 'un', 'une', 'et', 'est', 'dans', 'pour', 'avec',
  'sur', 'vous', 'votre', 'ce', 'cette', 'ces', 'qui', 'que', 'au', 'aux', 'sont', 'plus',
])

function detectMpLanguage(descr: string): 'en' | 'fr' {
  if (FRENCH_ACCENT_PATTERN.test(descr)) {
    return 'fr'
  }
  const words = descr.toLowerCase().match(/[a-zàâäçèéêëîïôöùûüÿœæ]+/g) ?? []
  const frenchStopWordCount = words.filter((word) => FRENCH_STOP_WORDS.has(word)).length
  return frenchStopWordCount >= 2 ? 'fr' : 'en'
}

function portablePath(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join('/')
}

function pathIdentity(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase('en-US')
}

async function findFileCaseInsensitive(directory: string, fileName: string): Promise<string | undefined> {
  const expectedName = fileName.toLowerCase()
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const entry = entries.find((candidate) => candidate.isFile() && candidate.name.toLowerCase() === expectedName)
  return entry ? join(directory, entry.name) : undefined
}

async function findDirectoryCaseInsensitive(directory: string, directoryName: string): Promise<string | undefined> {
  const expectedName = directoryName.toLowerCase()
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const entry = entries.find((candidate) => candidate.isDirectory() && candidate.name.toLowerCase() === expectedName)
  return entry ? join(directory, entry.name) : undefined
}

function yamlObject(source: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(source)
  if (parsed === null || parsed === undefined) {
    return {}
  }
  if (!isPlainObject(parsed)) {
    throw new Error('must contain a YAML object')
  }
  return parsed
}

/** MP's own slug rule is looser than ours (no strict single-hyphen-between-
 * words requirement) — always pass MP-sourced names/slugs through our own
 * slugify() so the result is guaranteed importable, same as any
 * MPX-authored content. */
function mpSlug(value: string): string {
  return slugify(value)
}

/** "my-first-map" / "My First Map" / "my_first_map" -> "My First Map" —
 * a readable fallback name for a map/encounter reference, which MP's own
 * Module.yaml declaration never carries (see MpArchiveReference.name). */
function humanizeFileName(value: string): string {
  const words = value
    .replaceAll(/[_-]+/g, ' ')
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

function stripHeadingMarkdown(value: string): string {
  return value
    .replace(/\s+\{[^}]+\}\s*$/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .trim()
}

function markdownHeadings(source: string): Array<{ level: number; name: string }> {
  const headings: Array<{ level: number; name: string }> = []
  let fence: string | undefined

  for (const line of source.split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      fence = !fence ? marker : fence === marker ? undefined : fence
      continue
    }
    if (fence) {
      continue
    }
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/)
    if (!headingMatch) {
      continue
    }
    const name = stripHeadingMarkdown(headingMatch[2])
    if (name) {
      headings.push({ level: headingMatch[1].length, name })
    }
  }
  return headings
}

function pagebreakLevels(value: unknown): number[] {
  if (typeof value !== 'string') {
    return []
  }
  const levels: number[] = []
  for (const entry of value.split(',')) {
    const match = entry.trim().toLowerCase().match(/^h([1-6])$/)
    if (match) {
      const level = Number(match[1])
      if (!levels.includes(level)) {
        levels.push(level)
      }
    }
  }
  return levels
}

function markdownResourcePaths(source: string): string[] {
  const paths: string[] = []
  for (const match of source.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?/g)) {
    paths.push(match[1])
  }
  for (const match of source.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    paths.push(match[1])
  }
  return paths
}

/** Counts fenced ```Item/```Spell/```Monster blocks — MP's own inline
 * compendium authoring. Reshaping their fields to MPX's vocabulary is a
 * separate, later phase; this analysis only flags how many exist so a
 * conversion's notices can say so. */
function compendiumBlockCount(source: string): number {
  let count = 0
  let fence: string | undefined
  for (const line of source.split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)\s*(\S*)/)
    if (!fenceMatch) {
      continue
    }
    const marker = fenceMatch[1][0]
    if (!fence) {
      fence = marker
      if (/^(item|spell|monster)(?:\s|$)/i.test(fenceMatch[2])) {
        count += 1
      }
    } else if (fence === marker) {
      fence = undefined
    }
  }
  return count
}

export interface AnalyzeMpProjectOptions {
  allowMissingManifest?: boolean
}

export async function analyzeMpProject(
  projectDirectory: string,
  options: AnalyzeMpProjectOptions = {},
): Promise<MpProjectAnalysis> {
  const modulePath = await findFileCaseInsensitive(projectDirectory, 'module.yaml')
  if (!modulePath && !options.allowMissingManifest) {
    throw new Error('No Module.yaml file was found at the root of the MP project.')
  }

  const notices: MpAnalysisNotice[] = []
  const moduleData = modulePath ? yamlObject(await readFile(modulePath, 'utf8')) : {}
  if (!modulePath) {
    notices.push({
      code: 'missing-module-manifest',
      message: 'The MP project has no Module.yaml file; module metadata must be completed after conversion.',
    })
  }

  const moduleId = nonEmptyString(moduleData.id)
  if (moduleId && !isUuid(moduleId)) {
    notices.push({
      code: 'invalid-module-id',
      message: 'Module.yaml has an id that is not a valid UUID; a new one will be generated.',
      path: modulePath ? portablePath(projectDirectory, modulePath) : undefined,
    })
  }

  const moduleName = nonEmptyString(moduleData.name) ?? basename(projectDirectory)
  const moduleImage = nonEmptyString(moduleData.cover) ?? ''
  const moduleDescr = nonEmptyString(moduleData.description) ?? ''
  const module: MpModuleAnalysis = {
    acronym: nonEmptyString(moduleData.code) ?? '',
    author: nonEmptyString(moduleData.author) ?? '',
    autoDetectedLanguage: detectMpLanguage(moduleDescr),
    autoDetectRollTables: typeof moduleData['create-roll-tables'] === 'boolean' ? moduleData['create-roll-tables'] : true,
    category: nonEmptyString(moduleData.category) ?? '',
    descr: moduleDescr,
    id: moduleId && isUuid(moduleId) ? moduleId : undefined,
    image: moduleImage,
    name: moduleName,
    slug: mpSlug(nonEmptyString(moduleData.slug) ?? moduleName),
    version:
      typeof moduleData.version === 'number' || typeof moduleData.version === 'string'
        ? String(moduleData.version)
        : '1.0.0',
  }

  for (const unsupportedKey of [
    'auto-increment-version',
    'compress-images',
    'delete-empty-groups',
    'print-cover',
    'print-document-size',
    'print-link-update',
  ]) {
    if (moduleData[unsupportedKey] !== undefined) {
      notices.push({
        code: 'unsupported-module-option',
        message: `The MP option "${unsupportedKey}" has no MPX equivalent and was ignored.`,
        path: modulePath ? portablePath(projectDirectory, modulePath) : undefined,
      })
    }
  }

  const pages: MpPageAnalysis[] = []
  let excludedPageCount = 0
  const groups: MpGroupAnalysis[] = []
  const archives: MpArchiveReference[] = []
  const referencedImages = new Map<string, string>()
  const addReferencedImage = (imagePath: string): void => {
    const normalizedPath = imagePath.replaceAll('\\', '/')
    referencedImages.set(pathIdentity(normalizedPath), normalizedPath)
  }
  const usedSlugs = new Set<string>()
  let compendiumBlocksTotal = 0

  const uniqueSlug = (value: string, explicit = false): string => {
    const baseSlug = mpSlug(value)
    if (!usedSlugs.has(baseSlug)) {
      usedSlugs.add(baseSlug)
      return baseSlug
    }
    if (explicit) {
      notices.push({ code: 'duplicate-explicit-slug', message: `The explicit MP slug "${baseSlug}" is duplicated.` })
      return baseSlug
    }
    let suffix = 1
    let slug = `${baseSlug}-${suffix}`
    while (usedSlugs.has(slug)) {
      suffix += 1
      slug = `${baseSlug}-${suffix}`
    }
    usedSlugs.add(slug)
    return slug
  }

  const analyzeMarkdownFile = async (filePath: string, context: DirectoryContext): Promise<void> => {
    const sourcePath = portablePath(projectDirectory, filePath)
    const parsed = matter(await readFile(filePath, 'utf8'))
    compendiumBlocksTotal += compendiumBlockCount(parsed.content)

    for (const printField of [
      'cover',
      'footer',
      'hide-footer',
      'hide-footer-text',
      'pdf-page-style',
      'pdf-pagebreaks',
      'print-cover-only',
    ]) {
      if (parsed.data[printField] !== undefined) {
        notices.push({
          code: 'unsupported-page-option',
          message: `${sourcePath} uses the MP page option "${printField}", which has no MPX equivalent.`,
          path: sourcePath,
        })
      }
    }
    if (/\(print-(?:column|page)\)/.test(parsed.content)) {
      notices.push({
        code: 'print-marker',
        message: `${sourcePath} contains PDF-only print markers.`,
        path: sourcePath,
      })
    }
    if (/<!--\{[^}]+\}-->/.test(parsed.content)) {
      notices.push({
        code: 'legacy-decoration',
        message: `${sourcePath} uses the old blockquote-decoration comment syntax — rewritten to MPX's {.class} syntax.`,
        path: sourcePath,
      })
    }

    for (const resourcePath of markdownResourcePaths(parsed.content)) {
      let decodedResourcePath = resourcePath
      try {
        decodedResourcePath = decodeURIComponent(resourcePath)
      } catch {
        // Keep the original path so a malformed encoding remains visible.
      }
      if (/^(?:[a-z]+:|\/)/i.test(decodedResourcePath) && !/^\/images\//i.test(decodedResourcePath)) {
        continue
      }
      const normalizedPath = decodedResourcePath.replace(/^\.?\//, '')
      const resolvedPath = join(dirname(filePath), decodedResourcePath)
      const projectRelativePath = portablePath(projectDirectory, resolvedPath)
      addReferencedImage(/^images\//i.test(normalizedPath) ? normalizedPath : projectRelativePath)
    }

    const pageName = nonEmptyString(parsed.data.name) ?? basename(filePath)
    const includeIn = (nonEmptyString(parsed.data['include-in']) ?? context.includeIn).toLowerCase()
    if (includeIn === 'print' || includeIn === 'compendium') {
      excludedPageCount += 1
      return
    }

    const explicitParent = nonEmptyString(parsed.data.parent) ?? nonEmptyString(parsed.data['parent-page'])
    const inheritedParent = explicitParent ?? context.parentGroupSlug
    const rank = numberOrZero(parsed.data.order)
    const levels = pagebreakLevels(parsed.data['module-pagebreaks'] ?? parsed.data['module-pagebreak'])

    if (levels.length > 0) {
      const headings = markdownHeadings(parsed.content).filter((heading) => levels.includes(heading.level))
      const hierarchy: Array<{ levelIndex: number; slug: string } | undefined> = []
      const siblingRanks = new Map<string, number>()

      for (const heading of headings) {
        const levelIndex = levels.indexOf(heading.level)
        const slug = uniqueSlug(heading.name)
        let parentSlug = inheritedParent
        let parentKind: MpPageAnalysis['parentKind'] =
          inheritedParent && context.parentGroupSlug === inheritedParent ? 'group' : undefined

        for (let parentIndex = levelIndex - 1; parentIndex >= 0; parentIndex -= 1) {
          const candidate = hierarchy[parentIndex]
          if (candidate) {
            parentSlug = candidate.slug
            parentKind = 'page'
            break
          }
        }
        hierarchy[levelIndex] = { levelIndex, slug }
        hierarchy.length = levelIndex + 1
        const siblingKey = parentSlug ?? '__root__'
        const siblingRank = siblingRanks.get(siblingKey) ?? 0
        siblingRanks.set(siblingKey, siblingRank + 1)

        pages.push({
          headingLevel: heading.level,
          name: heading.name,
          origin: 'heading',
          parentKind,
          parentSlug,
          rank: parentKind === 'page' ? siblingRank : rank + siblingRank,
          slug,
          sourcePath,
        })
      }

      if (headings.length > 0) {
        notices.push({
          code: 'module-pagebreaks',
          message: `${sourcePath} splits into ${headings.length} MPX pages from its module-pagebreaks headings.`,
          path: sourcePath,
        })
        return
      }
    }

    const explicitSlug = nonEmptyString(parsed.data.slug)
    pages.push({
      name: pageName,
      origin: 'file',
      parentKind: inheritedParent && context.parentGroupSlug === inheritedParent ? 'group' : undefined,
      parentSlug: inheritedParent,
      rank,
      slug: uniqueSlug(explicitSlug ?? pageName, Boolean(explicitSlug)),
      sourcePath,
    })
  }

  const scanDirectory = async (directory: string, context: DirectoryContext): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    )

    for (const entry of entries) {
      if (entry.isFile() && !entry.name.startsWith('.') && entry.name.toLowerCase().endsWith('.md')) {
        await analyzeMarkdownFile(join(directory, entry.name), context)
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || TECHNICAL_DIRECTORIES.has(entry.name.toLowerCase())) {
        continue
      }
      const childDirectory = join(directory, entry.name)
      if (childDirectory !== projectDirectory && (await findFileCaseInsensitive(childDirectory, 'module.yaml'))) {
        continue
      }

      const groupPath = await findFileCaseInsensitive(childDirectory, 'group.yaml')
      const groupData = groupPath ? yamlObject(await readFile(groupPath, 'utf8')) : {}
      const ignoreGroup = (await findFileCaseInsensitive(childDirectory, '.ignoregroup')) !== undefined
      const includeIn = (nonEmptyString(groupData['include-in']) ?? 'all').toLowerCase()
      if (includeIn === 'files' || ignoreGroup) {
        continue
      }

      const groupName = nonEmptyString(groupData.name) ?? entry.name
      const explicitSlug = nonEmptyString(groupData.slug)
      const groupSlug = uniqueSlug(explicitSlug ?? `group-${mpSlug(groupName)}`, Boolean(explicitSlug))
      const groupParent = nonEmptyString(groupData.parent) ?? context.parentGroupSlug
      // A plain subfolder with no Group.yaml of its own is just a filesystem
      // organization detail in MP, not a real chapter — only a folder that
      // actually declares a Group.yaml becomes an MPX group. Its own
      // markdown files/subfolders are still scanned and attached to
      // whatever group the parent folder resolved to.
      const includedInModule = groupPath !== undefined && (includeIn === 'all' || includeIn === 'module')
      if (includedInModule) {
        groups.push({
          name: groupName,
          parentSlug: groupParent,
          rank: numberOrZero(groupData.order),
          slug: groupSlug,
          sourcePath: portablePath(projectDirectory, childDirectory),
        })
      }

      await scanDirectory(childDirectory, {
        includeIn: includedInModule ? includeIn : context.includeIn,
        parentGroupSlug: includedInModule ? groupSlug : context.parentGroupSlug,
      })
    }
  }

  await scanDirectory(projectDirectory, { includeIn: 'all' })

  for (const page of pages) {
    if (!page.parentSlug || page.parentKind) {
      continue
    }
    if (pages.some((candidate) => candidate.slug === page.parentSlug)) {
      page.parentKind = 'page'
    } else if (groups.some((candidate) => candidate.slug === page.parentSlug)) {
      page.parentKind = 'group'
    } else {
      notices.push({
        code: 'unknown-parent',
        message: `${page.sourcePath} references the unknown parent slug "${page.parentSlug}" — converted with no parent.`,
        path: page.sourcePath,
      })
      page.parentSlug = undefined
    }
  }

  const analyzeArchives = async (kind: MpArchiveReference['kind'], value: unknown): Promise<void> => {
    if (!Array.isArray(value)) {
      return
    }
    for (const entry of value) {
      if (!isPlainObject(entry)) {
        notices.push({ code: `invalid-${kind}-reference`, message: `Module.yaml contains an invalid ${kind} reference.` })
        continue
      }
      const referencedPath = nonEmptyString(entry.path)
      if (!referencedPath) {
        notices.push({ code: `invalid-${kind}-reference`, message: `A MP ${kind} reference has no path.` })
        continue
      }
      const explicitSlug = nonEmptyString(entry.slug)
      const baseName = basename(referencedPath, extname(referencedPath))
      archives.push({
        kind,
        name: humanizeFileName(baseName),
        parentSlug: nonEmptyString(entry.parent),
        rank: numberOrZero(entry.order),
        slug: uniqueSlug(explicitSlug ?? baseName, Boolean(explicitSlug)),
        sourcePath: referencedPath.replaceAll('\\', '/'),
      })
    }
  }
  await analyzeArchives('map', moduleData.maps)
  await analyzeArchives('encounter', moduleData.encounters)
  for (const archive of archives) {
    if (!archive.parentSlug) {
      continue
    }
    const known =
      pages.some((candidate) => candidate.slug === archive.parentSlug) ||
      groups.some((candidate) => candidate.slug === archive.parentSlug) ||
      archives.some((candidate) => candidate.slug === archive.parentSlug && candidate !== archive)
    if (!known) {
      notices.push({
        code: 'unknown-parent',
        message: `${archive.sourcePath} references the unknown parent slug "${archive.parentSlug}" — converted with no parent.`,
        path: archive.sourcePath,
      })
      archive.parentSlug = undefined
    }
  }
  // MPX just copies the source .zip through — it's an EncounterPlus export,
  // not something MP or MPX itself produced, so there's nothing to reshape.
  // Whatever format EncounterPlus wrote it in (its own concern, independent
  // of MP/MPX) is preserved as-is; MPX's own build step is what will
  // eventually complain if the export is in a format it can't read.
  if (archives.length > 0) {
    notices.push({
      code: 'archives-found',
      message: `${archives.length} MP map/encounter reference(s) found — running a conversion copies their source .zip file(s) over as-is.`,
    })
  }
  if (Array.isArray(moduleData.references) && moduleData.references.length > 0) {
    notices.push({
      code: 'deferred-references',
      message: `${moduleData.references.length} MP reference(s) are not convertible.`,
      path: modulePath ? portablePath(projectDirectory, modulePath) : undefined,
    })
  }

  if (compendiumBlocksTotal > 0) {
    notices.push({
      code: 'compendium-blocks-found',
      message: `${compendiumBlocksTotal} inline Item/Spell block(s) found — analysis only, running a conversion reshapes them into MPX's field format.`,
    })
  }

  const assetsDirectory = await findDirectoryCaseInsensitive(projectDirectory, 'assets')
  const assets: MpAssetsAnalysis = {
    directory: assetsDirectory ? portablePath(projectDirectory, assetsDirectory) : undefined,
  }

  const imageFiles: string[] = []
  const collectImages = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || TECHNICAL_DIRECTORIES.has(entry.name.toLowerCase())) {
        continue
      }
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        await collectImages(entryPath)
      } else if (entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        imageFiles.push(portablePath(projectDirectory, entryPath))
      }
    }
  }
  await collectImages(projectDirectory)

  if (moduleImage) {
    addReferencedImage(moduleImage.replace(/^\.\//, ''))
  }
  const imageFileIdentities = new Set(imageFiles.map(pathIdentity))
  const images = imageFiles
    .sort((left, right) => left.localeCompare(right))
    .map((imagePath) => ({
      path: imagePath,
      referenced: referencedImages.has(pathIdentity(imagePath)),
      role: (moduleImage && pathIdentity(imagePath) === pathIdentity(moduleImage) ? 'module' : 'content') as
        | 'module'
        | 'content',
    }))

  for (const referencedImage of referencedImages.values()) {
    if (!imageFileIdentities.has(pathIdentity(referencedImage))) {
      notices.push({
        code: 'missing-image',
        message: `A MP page references the missing image "${referencedImage}".`,
        path: referencedImage,
      })
    }
  }

  return {
    archives,
    assets,
    compendiumBlockCount: compendiumBlocksTotal,
    excludedPageCount,
    groups,
    images,
    module,
    modulePath: modulePath ? portablePath(projectDirectory, modulePath) : '',
    notices,
    pages,
    projectDirectory,
  }
}

// ---------------------------------------------------------------------------
// Conversion — writes the structural skeleton of an MPX project from an
// MpProjectAnalysis: module.json, pages, groups, images, a copy of the MP
// project's own assets/ (kept as-is, per explicit decision: conversion must
// not replace the original CSS/layout), and a .vscode/settings.json seeded
// with MPX defaults. Compendium block field reshaping and maps/encounters
// archive conversion are not part of this pass — inline blocks are copied
// through as plain text (see compendium-blocks-unconverted notice above).
// ---------------------------------------------------------------------------

export interface ConvertMpProjectOptions {
  /** Copied into assets/ only when the MP project has no assets/ folder of
   * its own — conversion must not overwrite an MP project's real theme. */
  fallbackTheme?: ProjectTheme
}

export interface ConvertMpProjectResult {
  analysis: MpProjectAnalysis
  destinationDirectory: string
  groupCount: number
  imageCount: number
  moduleId: string
  modulePath: string
  notices: MpAnalysisNotice[]
  pageCount: number
}

async function requireEmptyDestination(sourceDirectory: string, destinationDirectory: string): Promise<void> {
  const relativePath = relative(resolve(sourceDirectory), resolve(destinationDirectory))
  if (relativePath === '' || (!relativePath.startsWith('..') && !relativePath.startsWith(`..${sep}`))) {
    throw new Error('The MPX destination must be outside the MP source project.')
  }
  const entries = await readdir(destinationDirectory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  })
  if (entries.length > 0) {
    throw new Error('The MPX destination folder must be empty.')
  }
}

async function copyDirectory(sourceDirectory: string, targetDirectory: string): Promise<void> {
  const entries = await readdir(sourceDirectory, { withFileTypes: true })
  await mkdir(targetDirectory, { recursive: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue
    }
    const sourcePath = join(sourceDirectory, entry.name)
    const targetPath = join(targetDirectory, entry.name)
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath)
    } else if (entry.isFile()) {
      await copyFile(sourcePath, targetPath)
    }
  }
}

/** MP's own `<!--{blockquote:.red.color-links}-->` decoration comment —
 * MPX dropped the markdown-it-decorate extension that used to render it, so
 * without this rewrite the decoration would silently stop working, not just
 * look dated. Rewritten to MPX's own `{.red .color-links}` attribute syntax,
 * same visual result, still functional.
 *
 * markdown-it-decorate also accepted a second, more common MP authoring
 * style: `{.class ...}` appended directly onto a blockquote's own last line
 * (`...boue.{.read}`), rather than on its own line below it. MPX's
 * replacement, markdown-it-attrs, only recognizes the attribute on its own
 * line right after the block — glued to the text it's silently ignored, so
 * the blockquote renders as a plain quote instead of getting its class.
 * This splits it onto its own line so the same markup keeps working. */
function rewriteLegacyBlockquoteDecorations(content: string): string {
  let fenceMarker: string | undefined
  const lines = content.split('\n')
  const output: string[] = []

  for (const [index, rawLine] of lines.entries()) {
    const carriageReturn = rawLine.endsWith('\r') ? '\r' : ''
    const line = carriageReturn ? rawLine.slice(0, -1) : rawLine
    const fenceMatch = line.match(/^\s*(```+|~~~+)/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      fenceMarker = !fenceMarker ? marker : fenceMarker === marker ? undefined : fenceMarker
      output.push(rawLine)
      continue
    }
    if (fenceMarker) {
      output.push(rawLine)
      continue
    }

    const decorationMatch = line.match(/^(\s*)<!--\{\s*blockquote\s*:\s*((?:\.[A-Za-z_][\w-]*)+)\s*\}-->\s*$/)
    if (decorationMatch) {
      const classes = decorationMatch[2]
        .split('.')
        .filter(Boolean)
        .map((className) => `.${className}`)
        .join(' ')
      output.push(`${decorationMatch[1]}{${classes}}${carriageReturn}`)
      continue
    }

    // Only the last line of the blockquote carries the attribute, glued
    // onto its own text — e.g. "...votre présence.{.read}" or
    // "...(salles-inferieures-2)\n{.purple .color-links}" already on its
    // own line (left untouched by this branch, markdown-it-attrs handles it
    // natively). Detected only at the very end of a `>` line so ordinary
    // curly braces in prose are never mistaken for it.
    const gluedMatch = line.match(/^(\s*>.*\S)((?:\{\.[A-Za-z_][\w-]*(?:\s+\.[A-Za-z_][\w-]*)*\})+)\s*$/)
    if (gluedMatch) {
      const nextLine = lines[index + 1]
      const isLastBlockquoteLine = nextLine === undefined || !/^\s*>/.test(nextLine)
      if (isLastBlockquoteLine) {
        output.push(`${gluedMatch[1]}${carriageReturn}`)
        output.push(gluedMatch[2])
        continue
      }
    }

    output.push(rawLine)
  }
  return output.join('\n')
}

function rewriteImagePaths(content: string, targetByImageName: ReadonlyMap<string, string>): string {
  return content.replace(
    /(!\[[^\]]*\]\(\s*<?)([^)\s>]+)(>?[^)]*\))/g,
    (match, prefix: string, resourcePath: string, suffix: string) => {
      const imageName = targetByImageName.get(pathIdentity(basename(resourcePath)))
      return imageName ? `${prefix}images/${imageName}${suffix}` : match
    },
  )
}

function editablePageSource(page: MpPageAnalysis, content: string): string {
  const normalizedContent = content.replace(/^\r?\n/, '')
  return `---
name: ${JSON.stringify(page.name)}
slug: ${JSON.stringify(page.slug)}
rank: ${page.rank}
parent: ${JSON.stringify(page.parentSlug ?? '')}
---

${normalizedContent}`
}

const RESOURCE_FILE_EXTENSION_PATTERN = /\.(png|jpe?g|webp|gif|svg|avif|ttf|otf|woff2?)$/i

// EncounterPlus's own map/encounter manifest keys that hold an actual
// resource file name (as opposed to e.g. an asset's own display `name`,
// which is free text that can happen to end in something that looks like a
// file extension without being one — a real bug this list fixes: a tile's
// `asset.name` ("arrow white.png", lowercase display label) was getting
// treated as a second, distinct resource on top of its own `asset.resource`
// ("Arrow white.png", the real file), and both ended up in the rebuilt
// .zip — colliding once extracted on a case-insensitive filesystem). */
const RESOURCE_FILE_NAME_KEYS = new Set(['image', 'floor', 'token', 'resource', 'canvas', 'fog', 'snapshot'])

/** Recursively collects every resource file name referenced by a map/
 * encounter manifest object — scoped to EncounterPlus's own known
 * resource-bearing keys (RESOURCE_FILE_NAME_KEYS), not just any string that
 * happens to look like a file name (see that constant's own comment for why
 * that broader match caused a real collision). */
function collectResourceFileNames(value: unknown, into: Set<string>, key?: string): void {
  if (typeof value === 'string') {
    if (key && RESOURCE_FILE_NAME_KEYS.has(key) && RESOURCE_FILE_EXTENSION_PATTERN.test(value) && !value.includes('/') && !value.includes('\\')) {
      into.add(value)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectResourceFileNames(entry, into, key)
    }
    return
  }
  if (isPlainObject(value)) {
    for (const [entryKey, entry] of Object.entries(value)) {
      collectResourceFileNames(entry, into, entryKey)
    }
  }
}

/** Reads a root-level maps.json/encounters.json — not a documented MP
 * source format, but a residual build artifact MP itself writes next to
 * Module.yaml (see exportXML in the original tool) that a project folder
 * often still has lying around from a previous build. Indexed by slug, so
 * a missing archive with a matching slug can be reconstructed below rather
 * than losing the map/encounter entirely. */
async function loadRootManifestBySlug(
  projectDirectory: string,
  manifestFileName: string,
): Promise<Map<string, Record<string, unknown>>> {
  const bySlug = new Map<string, Record<string, unknown>>()
  const manifestPath = await findFileCaseInsensitive(projectDirectory, manifestFileName)
  if (!manifestPath) {
    return bySlug
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    return bySlug
  }
  if (!Array.isArray(parsed)) {
    return bySlug
  }
  for (const entry of parsed) {
    if (isPlainObject(entry) && typeof entry.slug === 'string' && entry.slug.trim()) {
      bySlug.set(entry.slug.trim(), entry)
    }
  }
  return bySlug
}

/** Renames every occurrence of `from` to `to` among a manifest's own string
 * values (recursively) — used to keep a reconstructed archive's manifest in
 * sync with a resource file renamed to dodge a collision with another
 * reconstructed archive (see writeReconstructedArchive's usedResourceNames).
 * Only touches values that are exactly the old resource name (a full
 * `image`/`floor`/`resource` field), never a substring match. */
function renameResourceInPlace(value: unknown, from: string, to: string): unknown {
  if (typeof value === 'string') {
    return value === from ? to : value
  }
  if (Array.isArray(value)) {
    return value.map((entry) => renameResourceInPlace(entry, from, to))
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, renameResourceInPlace(entry, from, to)]))
  }
  return value
}

/** Rebuilds a real EncounterPlus export .zip for a map/encounter entry
 * found in a root-level maps.json/encounters.json fallback (see
 * loadRootManifestBySlug) — MPX's own build (readExportArchive) requires an
 * actual archive on disk, not just a reference file, so this writes one:
 * the manifest itself plus every resource file it references that's still
 * sitting at the MP project's root.
 *
 * A real EncounterPlus export gives every resource file a unique name
 * (random suffix); MP's own root manifest just references the plain file
 * name as it sits in the project (e.g. "P.png", a tile reused across
 * several maps) — fine on its own, but buildModule.ts merges every
 * maps/*.zip's resources into one flat namespace and rejects a same-name
 * collision between two different archives. `usedResourceNames` is shared
 * across every reconstructed archive in a single conversion run, so a
 * resource is only renamed (slug-prefixed) when it actually collides with
 * one already claimed by an earlier map/encounter — not on every shared
 * asset, since most never collide in EncounterPlus's own namespace either. */
async function writeReconstructedArchive(
  projectDirectory: string,
  destinationPath: string,
  manifestFileName: string,
  record: Record<string, unknown>,
  slug: string,
  usedResourceNames: Map<string, string>,
): Promise<void> {
  const resourceNames = new Set<string>()
  collectResourceFileNames(record, resourceNames)

  const zip = new ZipFile()
  let manifestRecord: Record<string, unknown> = record
  for (const resourceName of resourceNames) {
    const resourcePath = await findFileCaseInsensitive(projectDirectory, resourceName)
    if (!resourcePath) {
      continue
    }
    const existingOwner = usedResourceNames.get(resourceName)
    const finalName = existingOwner && existingOwner !== slug ? `${slug}-${resourceName}` : resourceName
    if (finalName !== resourceName) {
      manifestRecord = renameResourceInPlace(manifestRecord, resourceName, finalName) as Record<string, unknown>
    }
    usedResourceNames.set(finalName, slug)
    zip.addFile(resourcePath, finalName)
  }
  zip.addBuffer(Buffer.from(JSON.stringify([manifestRecord])), manifestFileName)
  zip.end()

  await mkdir(dirname(destinationPath), { recursive: true })
  await new Promise<void>((resolvePromise, rejectPromise) => {
    zip.outputStream
      .pipe(createWriteStream(destinationPath))
      .on('close', () => resolvePromise())
      .on('error', rejectPromise)
  })
}

function settingsJson(module: MpModuleAnalysis): Record<string, boolean | string> {
  return {
    'mpx.autoIncrementVersion': true,
    'mpx.contentLanguage': module.autoDetectedLanguage,
    'mpx.defaultMeasurement': 'auto',
    'mpx.defaultShowSpellImage': true,
    'mpx.defaultShowSpellSchoolIcon': true,
    'mpx.defaultShowSpellAreaEffectIcon': true,
    'mpx.defaultShowSpellSources': true,
    'mpx.defaultShowSpellTags': true,
    'mpx.defaultShowItemImage': true,
    'mpx.defaultShowItemSources': true,
    'mpx.defaultShowItemTags': true,
    'mpx.defaultShowMonsterImage': true,
    'mpx.defaultShowMonsterToken': true,
    'mpx.defaultShowMonsterSources': true,
    'mpx.defaultShowMonsterTags': true,
    'mpx.autoDetectRollTables': module.autoDetectRollTables,
  }
}

export async function convertMpProject(
  sourceDirectory: string,
  destinationDirectory: string,
  options: ConvertMpProjectOptions = {},
): Promise<ConvertMpProjectResult> {
  const analysis = await analyzeMpProject(sourceDirectory, { allowMissingManifest: true })
  await requireEmptyDestination(sourceDirectory, destinationDirectory)

  for (const group of analysis.groups) {
    if (!isValidSlug(group.slug)) {
      throw new Error(`${group.sourcePath} produced the invalid slug "${group.slug}".`)
    }
  }
  for (const page of analysis.pages) {
    if (!isValidSlug(page.slug)) {
      throw new Error(`${page.sourcePath} produced the invalid slug "${page.slug}".`)
    }
  }

  const moduleId = (analysis.module.id ?? randomUUID()).toUpperCase()
  // The analysis-phase notices only apply to a standalone analyzeMpProject
  // call (no conversion happened yet) — convertMpProject actually reshapes
  // compendium blocks and copies archives below, so its own, more precise
  // notices replace these two.
  const notices = analysis.notices.filter(
    (notice) => notice.code !== 'compendium-blocks-found' && notice.code !== 'archives-found',
  )

  await mkdir(destinationDirectory, { recursive: true })

  // Images: every referenced content image goes into images/. The module
  // cover is a separate case — module.json's own "image" field is resolved
  // project-root-relative (matching a native MPX project and how buildModule
  // itself validates it). A cover already living under images/ is treated
  // like any other content image (copied there, referenced as
  // "images/name"); a cover living elsewhere is copied to the destination
  // root instead, not folded into the images/ count/copy.
  const moduleImage = analysis.images.find((image) => image.role === 'module' && image.referenced)
  const moduleImageUnderImages = moduleImage && /^images\//i.test(moduleImage.path) ? moduleImage : undefined
  const imagesToCopy = [
    ...analysis.images.filter((image) => image.role === 'content' && image.referenced),
    ...(moduleImageUnderImages ? [moduleImageUnderImages] : []),
  ]
  const targetByImageName = new Map<string, string>()
  for (const image of imagesToCopy) {
    const identity = pathIdentity(basename(image.path))
    if (targetByImageName.has(identity)) {
      throw new Error(`Multiple referenced MP images resolve to "${basename(image.path)}".`)
    }
    targetByImageName.set(identity, basename(image.path))
  }

  let convertedModuleImage = ''
  if (moduleImage) {
    convertedModuleImage = moduleImageUnderImages ? `images/${basename(moduleImage.path)}` : basename(moduleImage.path)
    if (!moduleImageUnderImages) {
      await copyFile(join(sourceDirectory, moduleImage.path), join(destinationDirectory, basename(moduleImage.path)))
    }
  }

  const moduleJson = {
    id: moduleId,
    acronym: analysis.module.acronym,
    author: analysis.module.author,
    banner: '',
    category: analysis.module.category,
    descr: analysis.module.descr,
    image: convertedModuleImage,
    name: analysis.module.name,
    package: '',
    repository: '',
    shortDescr: '',
    slug: analysis.module.slug,
    system: 'dnd5e',
    tags: [] as string[],
    version: analysis.module.version,
    website: '',
  }
  await writeFile(join(destinationDirectory, 'module.json'), `${JSON.stringify(moduleJson, null, 2)}\n`, 'utf8')

  if (analysis.groups.length > 0) {
    await mkdir(join(destinationDirectory, 'groups'))
    for (const group of analysis.groups) {
      await writeFile(
        join(destinationDirectory, 'groups', `${group.slug}.json`),
        `${JSON.stringify({ name: group.name, slug: group.slug, rank: group.rank, parent: group.parentSlug ?? '' }, null, 2)}\n`,
        'utf8',
      )
    }
  }

  // Maps/encounters: the .zip is an EncounterPlus export MP only ever
  // copied through, never generated itself — but MPX's own build already
  // knows how to read one (readExportArchive), so the conversion inspects
  // it too: a .zip already exported in EncounterPlus's current maps.json/
  // encounters.json format works immediately, with its real name/descr
  // pulled from the manifest instead of guessed from the file name. A .zip
  // still in the older XML export format (or anything unreadable) is still
  // copied through as-is, with a notice asking for a fresh V5 export.
  const ARCHIVE_FOLDER_BY_KIND = { encounter: 'encounters', map: 'maps' } as const
  const ARCHIVE_MANIFEST_BY_KIND = { encounter: 'encounters.json', map: 'maps.json' } as const
  const rootManifestsByKind = {
    encounter: await loadRootManifestBySlug(sourceDirectory, 'encounters.json'),
    map: await loadRootManifestBySlug(sourceDirectory, 'maps.json'),
  }
  // Shared across every reconstructed archive below — see
  // writeReconstructedArchive's own comment for why a resource is only
  // renamed when it actually collides with one already claimed.
  const usedReconstructedResourceNames = new Map<string, string>()
  let archiveCount = 0
  let legacyArchiveCount = 0
  let reconstructedArchiveCount = 0
  for (const archive of analysis.archives) {
    const folder = ARCHIVE_FOLDER_BY_KIND[archive.kind]
    const targetName = `${archive.slug}.zip`
    const absoluteSourcePath = join(sourceDirectory, archive.sourcePath)
    const destinationArchivePath = join(destinationDirectory, folder, targetName)
    let reconstructed = false
    try {
      await mkdir(join(destinationDirectory, folder), { recursive: true })
      await copyFile(absoluteSourcePath, destinationArchivePath)
    } catch {
      // The .zip Module.yaml references is gone — MP itself never reads
      // this file either, only copies it through, so its absence loses
      // nothing MP could recover. But a leftover root maps.json/
      // encounters.json (see loadRootManifestBySlug) is a residual build
      // artifact that still has this exact map/encounter's own data —
      // reconstructing a fresh .zip from it recovers what would otherwise
      // be permanently lost.
      const rootEntry = rootManifestsByKind[archive.kind].get(archive.slug)
      if (!rootEntry) {
        notices.push({
          code: 'missing-archive',
          message: `${archive.sourcePath} — this MP ${archive.kind} reference's .zip file couldn't be found and was skipped.`,
          path: archive.sourcePath,
        })
        continue
      }
      try {
        await writeReconstructedArchive(
          sourceDirectory,
          destinationArchivePath,
          ARCHIVE_MANIFEST_BY_KIND[archive.kind],
          rootEntry,
          archive.slug,
          usedReconstructedResourceNames,
        )
        reconstructed = true
        reconstructedArchiveCount += 1
      } catch {
        notices.push({
          code: 'missing-archive',
          message: `${archive.sourcePath} — this MP ${archive.kind} reference's .zip file couldn't be found, and rebuilding it from ${ARCHIVE_MANIFEST_BY_KIND[archive.kind]} failed too.`,
          path: archive.sourcePath,
        })
        continue
      }
    }

    const manifest = reconstructed
      ? { record: rootManifestsByKind[archive.kind].get(archive.slug) as Record<string, unknown> }
      : await readExportArchive(absoluteSourcePath, ARCHIVE_MANIFEST_BY_KIND[archive.kind]).catch(() => undefined)
    const name = (manifest && nonEmptyString(manifest.record.name)) || archive.name
    const descr = (manifest && nonEmptyString(manifest.record.descr)) || ''
    if (!manifest) {
      legacyArchiveCount += 1
    }
    await writeFile(
      join(destinationDirectory, folder, `${archive.slug}.json`),
      `${JSON.stringify({ name, slug: archive.slug, rank: archive.rank, parent: archive.parentSlug ?? '', path: `${folder}/${targetName}`, descr }, null, 2)}\n`,
      'utf8',
    )
    archiveCount += 1
  }
  if (archiveCount > 0) {
    notices.push({
      code: 'archives-converted',
      message: `Copied ${archiveCount} MP map/encounter .zip file(s) into maps/encounters.${
        reconstructedArchiveCount > 0
          ? ` ${reconstructedArchiveCount} had no .zip on disk and were rebuilt from a leftover root maps.json/encounters.json instead.`
          : ''
      }${
        legacyArchiveCount > 0
          ? ` ${legacyArchiveCount} of them aren't in EncounterPlus's current export format — re-export from EncounterPlus in V5 format for MPX to read them.`
          : ''
      }`,
    })
  }

  let itemBlockCount = 0
  let spellBlockCount = 0
  let monsterBlockCount = 0
  // Tracks which source file each spells//items//monsters/ target name came
  // from, so two different blocks that happen to share a bare filename
  // (e.g. two pages each with their own "cover.png") are caught instead of
  // silently overwriting one another.
  const compendiumImageSources = {
    item: new Map<string, string>(),
    monster: new Map<string, string>(),
    spell: new Map<string, string>(),
  }
  const COMPENDIUM_FOLDER_BY_KIND = { item: 'items', monster: 'monsters', spell: 'spells' } as const

  const copyCompendiumBlockImage = async (
    block: MpCompendiumBlockReshape,
    pageSourcePath: string,
  ): Promise<void> => {
    const folder = COMPENDIUM_FOLDER_BY_KIND[block.kind]
    for (const imageReference of block.imageReferences) {
      const targetName = basename(imageReference)
      const absoluteSourcePath = join(sourceDirectory, dirname(pageSourcePath), imageReference)
      const existingSource = compendiumImageSources[block.kind].get(targetName)
      if (existingSource && existingSource !== absoluteSourcePath) {
        notices.push({
          code: 'duplicate-compendium-image',
          message: `${pageSourcePath} — the ${block.kind} "${block.name ?? 'unnamed'}"'s image "${targetName}" collides with another ${block.kind} block's image of the same name; kept the first one copied.`,
          path: pageSourcePath,
        })
        continue
      }
      try {
        await mkdir(join(destinationDirectory, folder), { recursive: true })
        await copyFile(absoluteSourcePath, join(destinationDirectory, folder, targetName))
        compendiumImageSources[block.kind].set(targetName, absoluteSourcePath)
      } catch {
        notices.push({
          code: 'missing-compendium-image',
          message: `${pageSourcePath} — the ${block.kind} "${block.name ?? 'unnamed'}" references a missing image: "${imageReference}".`,
          path: pageSourcePath,
        })
      }
    }
  }

  if (analysis.pages.length > 0) {
    await mkdir(join(destinationDirectory, 'pages'))
    const pagesBySource = new Map<string, MpPageAnalysis[]>()
    for (const page of analysis.pages) {
      const bucket = pagesBySource.get(page.sourcePath) ?? []
      bucket.push(page)
      pagesBySource.set(page.sourcePath, bucket)
    }
    for (const [sourcePath, pagesForSource] of pagesBySource) {
      const parsed = matter(await readFile(join(sourceDirectory, sourcePath), 'utf8'))
      const contents =
        pagesForSource.length > 1 || pagesForSource[0].origin === 'heading'
          ? splitMpPagebreakContent(parsed.content, pagesForSource)
          : [parsed.content]
      for (const [index, page] of pagesForSource.entries()) {
        const withDecorations = rewriteLegacyBlockquoteDecorations(contents[index] ?? contents[0])
        const { blocks, content: withCompendiumBlocks } = reshapeMpCompendiumBlocks(withDecorations)
        for (const block of blocks) {
          if (block.kind === 'spell') {
            spellBlockCount += 1
          } else if (block.kind === 'monster') {
            monsterBlockCount += 1
          } else {
            itemBlockCount += 1
          }
          await copyCompendiumBlockImage(block, sourcePath)
          for (const fieldNotice of block.fieldNotices) {
            notices.push({
              code: 'compendium-field-notice',
              message: `${sourcePath} — ${block.kind} "${block.name ?? 'unnamed'}", field "${fieldNotice.field}": ${fieldNotice.message}`,
              path: sourcePath,
            })
          }
        }
        const content = rewriteImagePaths(withCompendiumBlocks, targetByImageName)
        await writeFile(join(destinationDirectory, 'pages', `${page.slug}.md`), editablePageSource(page, content), 'utf8')
      }
    }
  }
  if (itemBlockCount > 0 || spellBlockCount > 0 || monsterBlockCount > 0) {
    notices.push({
      code: 'compendium-blocks-converted',
      message: `Reshaped ${itemBlockCount} inline item block(s), ${spellBlockCount} inline spell block(s), and ${monsterBlockCount} inline monster block(s) into MPX's field format — check the field notices above for anything that needs manual review.`,
    })
  }

  if (imagesToCopy.length > 0) {
    await mkdir(join(destinationDirectory, 'images'), { recursive: true })
    for (const image of imagesToCopy) {
      await copyFile(join(sourceDirectory, image.path), join(destinationDirectory, 'images', basename(image.path)))
    }
  }

  if (analysis.assets.directory) {
    await copyDirectory(join(sourceDirectory, analysis.assets.directory), join(destinationDirectory, 'assets'))
  } else if (options.fallbackTheme) {
    notices.push({
      code: 'fallback-theme',
      message: 'The MP project had no assets/ folder — seeded the default MPX theme instead of a converted one.',
    })
    await mkdir(join(destinationDirectory, 'assets'), { recursive: true })
    for (const filePath of await listFilesRecursively(options.fallbackTheme.themeDirectory)) {
      const relativePath = relative(options.fallbackTheme.themeDirectory, filePath)
      if (relativePath === 'theme.json') {
        continue
      }
      const targetPath = join(destinationDirectory, 'assets', relativePath)
      await mkdir(dirname(targetPath), { recursive: true })
      await copyFile(filePath, targetPath)
    }
  }

  await mkdir(join(destinationDirectory, '.vscode'), { recursive: true })
  await writeFile(
    join(destinationDirectory, '.vscode', 'settings.json'),
    `${JSON.stringify(settingsJson(analysis.module), null, 2)}\n`,
    'utf8',
  )

  return {
    analysis,
    destinationDirectory,
    groupCount: analysis.groups.length,
    imageCount: imagesToCopy.length,
    moduleId,
    modulePath: join(destinationDirectory, 'module.json'),
    notices,
    pageCount: analysis.pages.length,
  }
}

function splitMpPagebreakContent(content: string, pages: readonly MpPageAnalysis[]): string[] {
  const headingLevels = new Set(pages.map((page) => page.headingLevel).filter((level): level is number => level !== undefined))
  const boundaries: number[] = []
  let offset = 0
  let fence: string | undefined

  for (const lineWithEnding of content.match(/.*(?:\r?\n|$)/g) ?? []) {
    if (lineWithEnding.length === 0) {
      continue
    }
    const line = lineWithEnding.replace(/\r?\n$/, '')
    const fenceMatch = line.match(/^\s*(```+|~~~+)/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      fence = !fence ? marker : fence === marker ? undefined : fence
    } else if (!fence) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/)
      if (headingMatch && headingLevels.has(headingMatch[1].length)) {
        boundaries.push(offset)
      }
    }
    offset += lineWithEnding.length
  }

  if (boundaries.length !== pages.length) {
    throw new Error(`Could not reproduce the ${pages.length} MP module-pagebreak page boundaries safely.`)
  }
  return boundaries.map((start, index) => content.slice(start, boundaries[index + 1] ?? content.length))
}
