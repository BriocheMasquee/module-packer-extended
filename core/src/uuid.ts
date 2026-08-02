import { createHash } from 'node:crypto'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/** Deterministic UUID v5 (namespace + name), used so re-running a build assigns the same IDs. */
export function createUuidV5(name: string, namespaceUuid: string): string {
  const namespaceBytes = Buffer.from(namespaceUuid.replaceAll('-', ''), 'hex')
  const digest = createHash('sha1').update(namespaceBytes).update(name, 'utf8').digest()
  const uuidBytes = Buffer.from(digest.subarray(0, 16))

  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x50
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80

  const hex = uuidBytes.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}
