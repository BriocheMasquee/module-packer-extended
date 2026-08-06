import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { listFilesRecursively } from './fileScan.js'

// fontkit has no published TypeScript types — same reasoning as the
// markdown-it plugins in markdownRenderer.ts (typed `any` via require()).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fontkit = require('fontkit') as { openSync: OpenFontCollection }

export const PREVIEW_FONT_STYLE_PATH = '.vscode/mpx-preview-fonts.css'
const PREVIEW_FONT_DIRECTORY = '.vscode/mpx-preview-fonts'

const COLLECTION_EXTENSIONS = new Set(['.otc', '.ttc'])
const PROJECT_STYLE_PATHS = ['assets/css/global.css', 'assets/css/custom.css']

interface FontFaceMetadata {
  familyName?: string | null
  fullName?: string | null
  italicAngle?: number
  postscriptName?: string | null
  subfamilyName?: string | null
  'OS/2'?: {
    fsSelection?: {
      italic?: boolean
      oblique?: boolean
    }
    usWeightClass?: number
  }
}

interface FontCollectionMetadata {
  fonts?: FontFaceMetadata[]
}

export type OpenFontCollection = (fontPath: string) => FontCollectionMetadata | FontFaceMetadata

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath)
    return true
  } catch {
    return false
  }
}

function cssString(value: string): string {
  return JSON.stringify(value)
}

function decodeCssUrl(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** VSCode's markdown preview loads a project's own `@font-face` declarations
 * fine for an ordinary .ttf/.woff2 — but a font shipped as a .ttc/.otc
 * collection (several faces bundled in one file) never resolves there, only
 * in a real browser/EncounterPlus itself. This maps each collection file to
 * the font-family name(s) the project's own CSS already declares for it, so
 * the generated preview stylesheet can extract each face under the same
 * family name the rest of the project's CSS already expects. */
async function collectionAliases(
  projectDirectory: string,
  collectionPaths: readonly string[],
): Promise<Map<string, Set<string>>> {
  const knownCollections = new Set(collectionPaths.map((fontPath) => resolve(fontPath)))
  const aliases = new Map<string, Set<string>>()

  for (const relativeStylePath of PROJECT_STYLE_PATHS) {
    const stylePath = join(projectDirectory, relativeStylePath)
    if (!(await pathExists(stylePath))) {
      continue
    }

    const css = await readFile(stylePath, 'utf8')
    for (const match of css.matchAll(/@font-face\s*\{([\s\S]*?)\}/gi)) {
      const block = match[1]
      const familyMatch = block.match(/font-family\s*:\s*(?:['"]([^'"]+)['"]|([^;]+))/i)
      const family = (familyMatch?.[1] ?? familyMatch?.[2] ?? '').trim()
      if (!family) {
        continue
      }

      for (const urlMatch of block.matchAll(/url\(\s*(?:['"]([^'"]+)['"]|([^)'" \s]+))\s*\)/gi)) {
        const rawUrl = urlMatch[1] ?? urlMatch[2] ?? ''
        if (!rawUrl || /^[a-z]+:/i.test(rawUrl)) {
          continue
        }
        const pathWithoutFragment = rawUrl.split(/[?#]/, 1)[0]
        const referencedPath = resolve(dirname(stylePath), decodeCssUrl(pathWithoutFragment))
        if (!knownCollections.has(referencedPath)) {
          continue
        }
        const collectionFamilies = aliases.get(referencedPath) ?? new Set<string>()
        collectionFamilies.add(family)
        aliases.set(referencedPath, collectionFamilies)
      }
    }
  }

  return aliases
}

function fontWeight(face: FontFaceMetadata): number {
  const declaredWeight = face['OS/2']?.usWeightClass
  if (typeof declaredWeight === 'number' && declaredWeight >= 1 && declaredWeight <= 1000) {
    return declaredWeight
  }

  const subfamily = face.subfamilyName ?? ''
  if (/extra[ -]?black|ultra[ -]?black/i.test(subfamily)) return 950
  if (/black|heavy/i.test(subfamily)) return 900
  if (/extra[ -]?bold|ultra[ -]?bold/i.test(subfamily)) return 800
  if (/semi[ -]?bold|demi[ -]?bold/i.test(subfamily)) return 600
  if (/bold/i.test(subfamily)) return 700
  if (/medium/i.test(subfamily)) return 500
  if (/extra[ -]?light|ultra[ -]?light/i.test(subfamily)) return 200
  if (/light/i.test(subfamily)) return 300
  if (/thin|hairline/i.test(subfamily)) return 100
  return 400
}

function fontStyle(face: FontFaceMetadata): 'italic' | 'normal' {
  const selection = face['OS/2']?.fsSelection
  return selection?.italic || selection?.oblique || (face.italicAngle ?? 0) !== 0 || /italic|oblique/i.test(face.subfamilyName ?? '')
    ? 'italic'
    : 'normal'
}

function fontFaces(openedFont: FontCollectionMetadata | FontFaceMetadata): FontFaceMetadata[] {
  const collection = openedFont as FontCollectionMetadata
  return Array.isArray(collection.fonts) ? collection.fonts : [openedFont as FontFaceMetadata]
}

interface ExtractedCollectionFace {
  data: Buffer
  extension: '.otf' | '.ttf'
}

function alignToFourBytes(value: number): number {
  return (value + 3) & ~3
}

function bufferChecksum(buffer: Buffer): number {
  let checksum = 0
  for (let offset = 0; offset < buffer.length; offset += 4) {
    const value =
      ((buffer[offset] ?? 0) << 24) | ((buffer[offset + 1] ?? 0) << 16) | ((buffer[offset + 2] ?? 0) << 8) | (buffer[offset + 3] ?? 0)
    checksum = (checksum + (value >>> 0)) >>> 0
  }
  return checksum
}

/** Extracts a single face out of a .ttc/.otc collection as a standalone
 * .ttf/.otf — VSCode's preview (and most non-EncounterPlus renderers) can't
 * address one face inside a collection directly, only a whole font file. */
function extractSfntFace(collection: Buffer, faceOffset: number): ExtractedCollectionFace {
  if (faceOffset < 0 || faceOffset + 12 > collection.length) {
    throw new Error('The collection contains an invalid face offset.')
  }

  const numTables = collection.readUInt16BE(faceOffset + 4)
  const directoryLength = 12 + numTables * 16
  if (faceOffset + directoryLength > collection.length) {
    throw new Error('The collection contains an incomplete table directory.')
  }

  const tables: Array<{ length: number; sourceOffset: number; tag: string }> = []
  let outputLength = alignToFourBytes(directoryLength)
  for (let tableIndex = 0; tableIndex < numTables; tableIndex += 1) {
    const recordOffset = faceOffset + 12 + tableIndex * 16
    const tag = collection.toString('ascii', recordOffset, recordOffset + 4)
    const sourceOffset = collection.readUInt32BE(recordOffset + 8)
    const length = collection.readUInt32BE(recordOffset + 12)
    if (sourceOffset + length > collection.length) {
      throw new Error(`The ${tag} table exceeds the collection size.`)
    }
    tables.push({ length, sourceOffset, tag })
    outputLength += alignToFourBytes(length)
  }

  const output = Buffer.alloc(outputLength)
  collection.copy(output, 0, faceOffset, faceOffset + 12)
  let targetOffset = alignToFourBytes(directoryLength)
  let headTableOffset: number | undefined

  for (const [tableIndex, table] of tables.entries()) {
    const recordOffset = 12 + tableIndex * 16
    output.write(table.tag, recordOffset, 4, 'ascii')
    collection.copy(output, targetOffset, table.sourceOffset, table.sourceOffset + table.length)
    if (table.tag === 'head' && table.length >= 12) {
      headTableOffset = targetOffset
      output.writeUInt32BE(0, targetOffset + 8)
    }
    const tableChecksum = bufferChecksum(output.subarray(targetOffset, targetOffset + alignToFourBytes(table.length)))
    output.writeUInt32BE(tableChecksum, recordOffset + 4)
    output.writeUInt32BE(targetOffset, recordOffset + 8)
    output.writeUInt32BE(table.length, recordOffset + 12)
    targetOffset += alignToFourBytes(table.length)
  }

  if (headTableOffset !== undefined) {
    const adjustment = (0xb1b0afba - bufferChecksum(output)) >>> 0
    output.writeUInt32BE(adjustment, headTableOffset + 8)
  }

  return {
    data: output,
    extension: output.toString('ascii', 0, 4) === 'OTTO' ? '.otf' : '.ttf',
  }
}

function extractCollectionFaces(collection: Buffer): ExtractedCollectionFace[] {
  if (collection.length < 12 || collection.toString('ascii', 0, 4) !== 'ttcf') {
    throw new Error('The file is not a TrueType/OpenType collection.')
  }

  const faceCount = collection.readUInt32BE(8)
  if (faceCount === 0 || faceCount > 1000 || 12 + faceCount * 4 > collection.length) {
    throw new Error('The collection contains an invalid face count.')
  }

  const faces: ExtractedCollectionFace[] = []
  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    faces.push(extractSfntFace(collection, collection.readUInt32BE(12 + faceIndex * 4)))
  }
  return faces
}

function safeFontFileName(value: string): string {
  const normalized = value.replaceAll(/[^a-z0-9._-]+/gi, '-')
  return normalized.replace(/^-+|-+$/g, '') || 'font-face'
}

/** Generates `.vscode/mpx-preview-fonts.css`, extracting each face of every
 * `.ttc`/`.otc` font collection under `assets/font/` into its own file under
 * `.vscode/mpx-preview-fonts/` and declaring a matching `@font-face` for it —
 * a preview-only cache excluded from the built .module, letting VSCode's
 * Markdown preview render a collection-sourced font the same way a real
 * browser/EncounterPlus already does. Returns the stylesheet's project-
 * relative path when it wrote one, or undefined when the project has no
 * font collection (any previously generated cache is removed either way). */
export async function generatePreviewFontStyles(
  projectDirectory: string,
  openFontCollection: OpenFontCollection = fontkit.openSync,
): Promise<string | undefined> {
  const stylePath = join(projectDirectory, PREVIEW_FONT_STYLE_PATH)
  const extractedFontDirectory = join(projectDirectory, PREVIEW_FONT_DIRECTORY)
  const collectionPaths = (await listFilesRecursively(join(projectDirectory, 'assets', 'font'))).filter((fontPath) =>
    COLLECTION_EXTENSIONS.has(extname(fontPath).toLowerCase()),
  )

  if (collectionPaths.length === 0) {
    await rm(stylePath, { force: true })
    await rm(extractedFontDirectory, { recursive: true, force: true })
    return undefined
  }

  const aliases = await collectionAliases(projectDirectory, collectionPaths)
  const rules: string[] = []
  const generatedFaces = new Set<string>()
  const styleDirectory = dirname(stylePath)
  await rm(extractedFontDirectory, { recursive: true, force: true })
  await mkdir(extractedFontDirectory, { recursive: true })

  for (const collectionPath of collectionPaths) {
    let openedFont: FontCollectionMetadata | FontFaceMetadata
    let extractedFaces: ExtractedCollectionFace[]
    try {
      openedFont = openFontCollection(collectionPath)
      extractedFaces = extractCollectionFaces(await readFile(collectionPath))
    } catch (error: unknown) {
      console.warn(`MPX could not inspect preview font collection ${collectionPath}.`, error)
      continue
    }

    const metadataFaces = fontFaces(openedFont)
    for (let faceIndex = 0; faceIndex < Math.min(metadataFaces.length, extractedFaces.length); faceIndex += 1) {
      const face = metadataFaces[faceIndex]
      const extractedFace = extractedFaces[faceIndex]
      if (!face.postscriptName) {
        continue
      }

      const families = new Set<string>([...(aliases.get(resolve(collectionPath)) ?? [])])
      if (face.familyName) {
        families.add(face.familyName)
      }

      const weight = fontWeight(face)
      const style = fontStyle(face)
      const extractedFileName = `${safeFontFileName(face.postscriptName)}${extractedFace.extension}`
      const extractedPath = join(extractedFontDirectory, extractedFileName)
      await writeFile(extractedPath, extractedFace.data)
      const extractedUrl = relative(styleDirectory, extractedPath).replaceAll('\\', '/')
      const format = extractedFace.extension === '.otf' ? 'opentype' : 'truetype'

      for (const family of families) {
        const faceKey = `${family} ${face.postscriptName} ${weight} ${style}`
        if (generatedFaces.has(faceKey)) {
          continue
        }
        generatedFaces.add(faceKey)

        const sources = [`url(${cssString(extractedUrl)}) format(${cssString(format)})`]
        if (face.fullName) {
          sources.push(`local(${cssString(face.fullName)})`)
        }
        rules.push(
          [
            '@font-face {',
            `  font-family: ${cssString(family)};`,
            `  src: ${sources.join(', ')};`,
            `  font-weight: ${weight};`,
            `  font-style: ${style};`,
            '  font-display: swap;',
            '}',
          ].join('\n'),
        )
      }
    }
  }

  if (rules.length === 0) {
    await rm(stylePath, { force: true })
    await rm(extractedFontDirectory, { recursive: true, force: true })
    return undefined
  }

  await mkdir(styleDirectory, { recursive: true })
  await writeFile(
    stylePath,
    ['/* Generated by MPX for VS Code preview only. */', '/* Original module fonts and styles are not modified. */', '', rules.join('\n\n'), ''].join(
      '\n',
    ),
    'utf8',
  )
  return PREVIEW_FONT_STYLE_PATH
}
