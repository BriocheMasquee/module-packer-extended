const assert = require('node:assert/strict')
const { createWriteStream } = require('node:fs')
const { mkdtemp } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')
const { ZipFile } = require('yazl')

const { detectManifestFileName } = require('../dist/index.js')

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), 'mpx-core-export-test-'))
}

async function writeZip(destPath, entries) {
  await new Promise((resolvePromise, rejectPromise) => {
    const zip = new ZipFile()
    for (const [name, content] of Object.entries(entries)) {
      zip.addBuffer(Buffer.from(content), name)
    }
    zip.outputStream.pipe(createWriteStream(destPath)).on('close', resolvePromise).on('error', rejectPromise)
    zip.end()
  })
}

test('detectManifestFileName finds the single root-level .json manifest', async () => {
  const root = await makeTempDir()
  const zipPath = join(root, 'export.zip')
  await writeZip(zipPath, { 'rules.json': '[]', 'rules/cover.png': 'fake-bytes' })

  assert.equal(await detectManifestFileName(zipPath), 'rules.json')
})

test('detectManifestFileName returns undefined when there is no root-level .json file', async () => {
  const root = await makeTempDir()
  const zipPath = join(root, 'export.zip')
  await writeZip(zipPath, { 'rules/cover.png': 'fake-bytes' })

  assert.equal(await detectManifestFileName(zipPath), undefined)
})

test('detectManifestFileName returns undefined when more than one root-level .json file is present', async () => {
  const root = await makeTempDir()
  const zipPath = join(root, 'export.zip')
  await writeZip(zipPath, { 'rules.json': '[]', 'other.json': '[]' })

  assert.equal(await detectManifestFileName(zipPath), undefined)
})

test('detectManifestFileName returns undefined for a file that is not a zip', async () => {
  const root = await makeTempDir()
  const notAZip = join(root, 'not-a-zip.zip')
  await require('node:fs/promises').writeFile(notAZip, 'plain text, not a zip archive')

  assert.equal(await detectManifestFileName(notAZip), undefined)
})
